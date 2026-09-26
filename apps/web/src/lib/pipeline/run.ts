import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type ProjectMemory, type Role } from "@/types/db";
import { completeWithResilience as complete, DEFAULT_PROVIDER_CONFIG, type CompletionResult, type ProviderConfig, type ProviderName } from "@/lib/providers";
import { ROLE_SYSTEM_PROMPTS } from "@/lib/pipeline/roles";
import {
  formatMemoryForPrompt,
  extractMemoryUpdate,
  stripMemoryBlock,
  parseStrategistOutput,
} from "@/lib/pipeline/memory";
import { decryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { assertRoleAllowed } from "@/lib/capabilities";
import { getIntegrationApiKey } from "@/lib/secrets";
import { runRoleAgent, isCodebuffProvider } from "@/lib/agents/codebuff";
import { getSharedKeyConfig, isSharedProvider, SHARED_PROVIDER } from "@/lib/shared-ai";
import {
  declareScope,
  createSnapshot,
  captureSnapshotWrites,
  enforceScope,
  finalizeSnapshot,
  rejectSnapshot,
  builderFilesFromOutput,
  type SnapshotFileEntry,
} from "@/lib/pipeline/isolation";
import { randomUUID } from "crypto";

export interface PipelineStepResult {
  runId: string;
  role: Role;
  stepOrder: number;
  provider: string;
  model: string;
  input: string;
  output: string;
  tokensIn: number;
  tokensOut: number;
}

export interface PipelineRunResult {
  runId: string;
  mode: "direct" | "pipeline";
  steps: PipelineStepResult[];
  finalMessage: string;
  // Addendum 17 isolation summary: where the Builder's writes ended up.
  isolation?: {
    applied: boolean;
    status: "applied" | "ready" | "rejected" | "none";
    files: string[];
    violations: string[];
  };
}

interface RunPipelineArgs {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  userMessage: string;
  roleConfig?: Partial<Record<Role, ProviderConfig>>;
  // Invoked immediately after each step is persisted, so a streaming caller
  // (the API route) can push it to the client without waiting for the rest
  // of the pipeline to finish.
  onStep?: (step: PipelineStepResult) => void;
  // Invoked when a Codebuff-backed role reports mid-run activity (tool calls,
  // recoverable errors), so the chat UI can show live progress.
  onRoleEvent?: (event: { role: Role; message: string }) => void;
}

export async function runPipeline({
  supabase,
  projectId,
  userId,
  userMessage,
  roleConfig,
  onStep,
  onRoleEvent: sendRoleEvent,
}: RunPipelineArgs): Promise<PipelineRunResult> {
  const memory = await loadMemory(supabase, projectId);
  const memoryText = formatMemoryForPrompt(memory);
  const effectiveRoleConfig = {
    ...(await loadRoleConfig(supabase, projectId, userId)),
    ...roleConfig,
  };

  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      project_id: projectId,
      user_id: userId,
      user_message: userMessage,
      mode: "pipeline", // updated below once we know
      status: "running",
    })
    .select()
    .single();

  if (runError || !run) {
    throw new Error(`Failed to create pipeline run: ${runError?.message}`);
  }

  await logAudit(supabase, {
    projectId,
    userId,
    actor: "user",
    action: "pipeline.start",
    target: run.id,
    metadata: { message: userMessage.slice(0, 280) },
  });

  const steps: PipelineStepResult[] = [];

  try {
    // --- Step 1: Strategist decides route ---
    const strategistConfig = effectiveRoleConfig.strategist ?? DEFAULT_PROVIDER_CONFIG;
    const strategistPrompt = `${memoryText}\n\nUSER MESSAGE:\n${userMessage}`;
    const strategistResult = isCodebuffProvider(strategistConfig.provider)
      ? await runRoleViaCodebuff({
          supabase,
          projectId,
          userId,
          runId: run.id,
          role: "strategist",
          prompt: strategistPrompt,
          config: strategistConfig,
          onEvent: (message) => sendRoleEvent?.({ role: "strategist", message }),
        })
      : { ...(await complete(strategistConfig, {
          system: ROLE_SYSTEM_PROMPTS.strategist,
          prompt: strategistPrompt,
        })), structured: null };

    const strategistStep = await persistStep(supabase, run.id, {
      role: "strategist",
      stepOrder: 1,
      provider: strategistConfig.provider,
      model: strategistConfig.model,
      input: strategistPrompt,
      output: strategistResult.text,
      tokensIn: strategistResult.tokensIn,
      tokensOut: strategistResult.tokensOut,
    });
    steps.push(strategistStep);
    onStep?.(strategistStep);
    await logAudit(supabase, {
      projectId,
      userId,
      actor: "strategist",
      action: "pipeline.step",
      target: run.id,
      metadata: {
        provider: strategistStep.provider,
        model: strategistStep.model,
        tokensIn: strategistStep.tokensIn,
        tokensOut: strategistStep.tokensOut,
      },
    });

    // The Codebuff strategist returns structured output directly; the plain
    // LLM path falls back to fenced-block parsing.
    const { needsFullPipeline, direction } =
      isCodebuffProvider(strategistConfig.provider) && strategistResult.structured
        ? {
            needsFullPipeline: Boolean(strategistResult.structured.needs_full_pipeline),
            direction: String(strategistResult.structured.direction ?? ""),
          }
        : parseStrategistOutput(strategistResult.text);
    const rolesToRun: Role[] = needsFullPipeline
      ? ["builder", "analyst", "qa", "ops"]
      : ["ops"];

    // --- Remaining steps: either straight to Ops, or Builder -> Analyst -> QA -> Ops ---
    const priorOutputs: Partial<Record<Role, string>> = { strategist: direction };
    let stepOrder = 2;

    const structuredByRole: Partial<Record<Role, Record<string, unknown>>> = {};

    // --- Addendum 17: agent isolation setup --------------------------------
    // Every run that may write files gets a per-run snapshot (the isolated
    // "branch", nexus/run-<id>). Builder writes land there, never directly in
    // the files table, until scope enforcement passes and the snapshot is
    // applied (auto-merge by default, or held for review per project).
    // Snapshots are keyed by run_id, so parallel runs are isolated from each
    // other by construction.
    const isBuildRun = rolesToRun.includes("builder");
    let declaredScope: string[] = [];
    let builderFiles: SnapshotFileEntry[] = [];
    let scopeRetryUsed = false;
    let scopeBlocked = false;
    let isolation: PipelineRunResult["isolation"] | undefined;

    if (isBuildRun) {
      declaredScope = await declareScope({
        supabase,
        projectId,
        userId,
        runId: run.id,
        userMessage,
        direction,
      });
      await createSnapshot({ supabase, projectId, runId: run.id, declaredScope });
    }

    for (const role of rolesToRun) {
      const config = effectiveRoleConfig[role] ?? DEFAULT_PROVIDER_CONFIG;
      const prompt = buildRolePrompt(memoryText, userMessage, priorOutputs);

      // Roles routed to "codebuff" run as real Codebuff agents (the same
      // runtime that powers Freebuff): tool use, structured outputs, retries.
      // Everything else keeps the plain single-shot provider call.
      const result = isCodebuffProvider(config.provider)
        ? await runRoleViaCodebuff({
            supabase,
            projectId,
            userId,
            runId: run.id,
            role,
            prompt,
            config,
            onEvent: (message) => sendRoleEvent?.({ role, message }),
          })
        : await complete(config, {
            system: ROLE_SYSTEM_PROMPTS[role],
            prompt,
          });

      if (result.structured) structuredByRole[role] = result.structured;

      const step = await persistStep(supabase, run.id, {
        role,
        stepOrder: stepOrder++,
        provider: config.provider,
        model: config.model,
        input: prompt,
        output: result.text,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
      steps.push(step);
      onStep?.(step);
      await logAudit(supabase, {
        projectId,
        userId,
        actor: role,
        action: "pipeline.step",
        target: run.id,
        metadata: { provider: step.provider, model: step.model, tokensIn: step.tokensIn, tokensOut: step.tokensOut },
      });
      priorOutputs[role] = result.text;

      // Builder output may contain files destined for the Code Canvas.
      // Addendum 17 isolation: writes NEVER go directly to the files table.
      // They are captured into the run's snapshot and enforced against the
      // File Scoper's declared scope; the merge into files happens later via
      // finalizeSnapshot (auto-merge or review-before-merge).
      if (role === "builder") {
        builderFiles = builderFilesFromOutput(result.text);

        const writeAllowed = await assertRoleAllowed(supabase, projectId, "builder", "write_files");
        if (builderFiles.length && !writeAllowed) {
          // Permission denied — record it and skip the writes; the run
          // itself continues so the rest of the pipeline still works.
          builderFiles = [];
          await logAudit(supabase, {
            projectId,
            userId,
            actor: "system",
            action: "capability.denied",
            target: "builder/write_files",
            metadata: { runId: run.id },
          });
        }

        if (builderFiles.length) {
          await captureSnapshotWrites({ supabase, projectId, runId: run.id, builderFiles });
          await logAudit(supabase, {
            projectId,
            userId,
            actor: "builder",
            action: "files.write",
            target: run.id,
            metadata: { paths: builderFiles.map((f) => f.path), isolated: true },
          });

          // Scope enforcement: any file outside the declared scope rejects
          // the run's output. One retry with the violation flagged; a second
          // violation stops the run and hands it to the user to review.
          const enforcement = await enforceScope({
            supabase,
            projectId,
            userId,
            runId: run.id,
            builderFiles,
            declaredScope,
          });

          if (enforcement.violations.length && enforcement.enforced) {
            if (!scopeRetryUsed) {
              scopeRetryUsed = true;
              sendRoleEvent?.({
                role: "builder",
                message: `Scope violation — retrying with the flagged paths: ${enforcement.violations.join(", ")}`,
              });

              // Fresh Builder pass with the violation explicitly flagged.
              const retryPrompt =
                `${prompt}\n\n---\n\nSCOPE VIOLATION — YOUR PREVIOUS PASS WAS BLOCKED.\n` +
                `You tried to modify files outside the intended scope: ${enforcement.violations.join(", ")}.\n` +
                `You may ONLY create or modify these files: ${declaredScope.join(", ")}.\n` +
                `Produce the corrected output using ONLY those paths.`;

              const retryResult = isCodebuffProvider(config.provider)
                ? await runRoleViaCodebuff({
                    supabase,
                    projectId,
                    userId,
                    runId: run.id,
                    role: "builder",
                    prompt: retryPrompt,
                    config,
                    onEvent: (message) => sendRoleEvent?.({ role: "builder", message }),
                  })
                : await complete(config, {
                    system: ROLE_SYSTEM_PROMPTS.builder,
                    prompt: retryPrompt,
                  });

              const retryStep = await persistStep(supabase, run.id, {
                role: "builder",
                stepOrder: stepOrder++,
                provider: config.provider,
                model: config.model,
                input: retryPrompt,
                output: retryResult.text,
                tokensIn: retryResult.tokensIn,
                tokensOut: retryResult.tokensOut,
              });
              steps.push(retryStep);
              onStep?.(retryStep);
              priorOutputs.builder = retryResult.text;

              // Re-check scope against the retried output.
              builderFiles = builderFilesFromOutput(retryResult.text);
              await captureSnapshotWrites({ supabase, projectId, runId: run.id, builderFiles });
              const retryEnforcement = await enforceScope({
                supabase,
                projectId,
                userId,
                runId: run.id,
                builderFiles,
                declaredScope,
              });

              if (retryEnforcement.violations.length && retryEnforcement.enforced) {
                // Second violation — stop looping. Hand it to the user with
                // a clear error; the snapshot stays rejected.
                scopeBlocked = true;
                await rejectSnapshot(supabase, run.id);
                await logAudit(supabase, {
                  projectId,
                  userId,
                  actor: "system",
                  action: "scope.blocked",
                  target: run.id,
                  metadata: { violations: retryEnforcement.violations, attempts: 2 },
                });
                throw new Error(
                  `Builder tried to modify files outside the intended scope — run blocked. ` +
                    `Files unexpectedly touched: ${retryEnforcement.violations.join(", ")}. ` +
                    `Nothing was merged into your project; review the run and adjust the request.`
                );
              }
            } else {
              scopeBlocked = true;
              await rejectSnapshot(supabase, run.id);
              throw new Error(
                `Builder tried to modify files outside the intended scope — run blocked. ` +
                  `Files unexpectedly touched: ${enforcement.violations.join(", ")}.`
              );
            }
          }
        }
      }
    }

    const opsOutput = priorOutputs.ops ?? "";
    // Prefer the structured Ops payload from the Codebuff path; fall back to
    // fenced-block parsing for the plain provider path.
    const opsStructured = structuredByRole.ops;
    const memoryUpdate = opsStructured
      ? {
          decisions: toStringArray(opsStructured.decisions),
          open_issues: toStringArray(opsStructured.open_issues),
          tech_stack: toStringArray(opsStructured.tech_stack),
        }
      : extractMemoryUpdate(opsOutput);
    const finalMessage =
      opsStructured && typeof opsStructured.text === "string"
        ? opsStructured.text
        : stripMemoryBlock(opsOutput);
    const mode = needsFullPipeline ? "pipeline" : "direct";

    // Every run ends with Ops and updates memory before returning, whether
    // it took the short path (Strategist -> Ops) or the full one. Ops must
    // still hold write_project_memory for the update to apply.
    if (await assertRoleAllowed(supabase, projectId, "ops", "write_project_memory")) {
      await applyMemoryUpdate(supabase, projectId, memory, memoryUpdate, run.id);
    } else {
      await logAudit(supabase, {
        projectId,
        userId,
        actor: "system",
        action: "capability.denied",
        target: "ops/write_project_memory",
        metadata: { runId: run.id },
      });
    }

    await supabase
      .from("pipeline_runs")
      .update({ mode, status: "complete", completed_at: new Date().toISOString() })
      .eq("id", run.id);

    await logAudit(supabase, {
      projectId,
      userId,
      actor: "system",
      action: "pipeline.complete",
      target: run.id,
      metadata: { mode, steps: steps.length },
    });

    // --- Addendum 17: review-before-merge --------------------------------
    // QA/Ops finished and scope is ok: apply the snapshot (auto-merge, the
    // default) or hold it at "ready" when the project requires merge
    // approval. The files table is only ever touched here — never during
    // the Builder's pass.
    if (isBuildRun && !scopeBlocked) {
      const { data: projectRow } = await supabase
        .from("projects")
        .select("require_merge_approval")
        .eq("id", projectId)
        .maybeSingle();
      const requireMergeApproval = projectRow?.require_merge_approval === true;

      const finalization = await finalizeSnapshot({
        supabase,
        projectId,
        userId,
        runId: run.id,
        requireMergeApproval,
      });

      isolation = {
        applied: finalization.applied,
        status: finalization.status,
        files: builderFiles.map((f) => f.path),
        violations: [],
      };

      if (finalization.status === "ready") {
        await logAudit(supabase, {
          projectId,
          userId,
          actor: "system",
          action: "merge.awaiting_approval",
          target: run.id,
          metadata: { files: builderFiles.map((f) => f.path) },
        });
      }
    } else if (isBuildRun) {
      isolation = {
        applied: false,
        status: "rejected",
        files: builderFiles.map((f) => f.path),
        violations: [],
      };
    }

    return { runId: run.id, mode, steps, finalMessage, isolation };
  } catch (err) {
    await supabase
      .from("pipeline_runs")
      .update({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    await logAudit(supabase, {
      projectId,
      userId,
      actor: "system",
      action: "pipeline.error",
      target: run.id,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

// Builds each role's ProviderConfig from the Model Router's role_models
// table. A role's provider is either a built-in ProviderName (with the
// user's decrypted api_keys row for that provider, if saved) or the name
// of an ai_provider integration for this project (with that integration's
// own base URL + decrypted key). Roles with no row fall back to
// DEFAULT_PROVIDER_CONFIG (and the server's env-var key) in the caller.
async function loadRoleConfig(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<Partial<Record<Role, ProviderConfig>>> {
  const [{ data: roleModels }, { data: apiKeys }, { data: integrations }] = await Promise.all([
    supabase.from("role_models").select("*").eq("project_id", projectId),
    supabase.from("api_keys").select("*").eq("user_id", userId),
    supabase.from("integrations").select("*").eq("project_id", projectId).eq("type", "ai_provider"),
  ]);

  const keysByProvider = new Map<ProviderName, string>();
  for (const row of apiKeys ?? []) {
    try {
      keysByProvider.set(row.provider as ProviderName, decryptSecret(row.encrypted_key));
    } catch {
      // Skip a key we can't decrypt (e.g. NEXUS_ENCRYPTION_KEY rotated)
      // rather than failing the whole run; the provider call will fall
      // back to the server's env var key, or fail clearly at call time.
    }
  }

  const integrationsByName = new Map((integrations ?? []).map((i) => [i.name, i]));

  const rowByRole = new Map((roleModels ?? []).map((r) => [r.role as Role, r]));

  const shared = getSharedKeyConfig();

  const config: Partial<Record<Role, ProviderConfig>> = {};
  for (const role of ROLES) {
    const row = rowByRole.get(role);
    // Zero-config default: a role with no Model Router row uses Nexus
    // Office's shared AI key (Phase 3) when the server has one configured.
    // Users override per role in the Model Router at any time; adding their
    // own integration/key always wins over the shared key.
    const provider = row?.provider ?? (shared ? SHARED_PROVIDER : DEFAULT_PROVIDER_CONFIG.provider);
    const integration = integrationsByName.get(provider);

    if (integration) {
      // Vault first (legacy api_key_encrypted column is the migration fallback).
      const apiKey = await getIntegrationApiKey(supabase, projectId, integration.name, integration.api_key_encrypted);
      config[role] = {
        provider,
        model: row?.model ?? DEFAULT_PROVIDER_CONFIG.model,
        // A user-added integration always wins; when no key is stored on the
        // integration itself, fall back to the app's shared env key for known
        // gateway providers (never sent to the client).
        apiKey:
          apiKey ??
          sharedKeyForIntegration(integration.name, integration.base_url) ??
          undefined,
        baseUrl: integration.base_url ?? undefined,
      };
      continue;
    }

    if (isSharedProvider(provider)) {
      config[role] = shared
        ? {
            provider: shared.provider,
            model: row?.model ?? shared.model,
            apiKey: shared.apiKey,
          }
        : {
            provider,
            model: row?.model ?? DEFAULT_PROVIDER_CONFIG.model,
            apiKey: undefined,
          };
      continue;
    }

    config[role] = {
      provider,
      model: row?.model ?? (shared ? shared.model : DEFAULT_PROVIDER_CONFIG.model),
      apiKey: keysByProvider.get(provider as ProviderName),
    };
  }
  return config;
}

async function loadMemory(supabase: SupabaseClient, projectId: string): Promise<ProjectMemory> {
  const { data, error } = await supabase
    .from("project_memory")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load project memory: ${error.message}`);

  if (data) return data as ProjectMemory;

  // Lazily create the memory row on first pipeline run for this project.
  const { data: created, error: createError } = await supabase
    .from("project_memory")
    .insert({ project_id: projectId })
    .select()
    .single();

  if (createError || !created) {
    throw new Error(`Failed to initialize project memory: ${createError?.message}`);
  }

  return created as ProjectMemory;
}

const CODEBUFF_PROVIDER = "codebuff";

// Shared server-side keys for known OpenAI-compatible gateways, used ONLY
// when a project added the integration by name but has no stored key on it
// (and the user has no personal key). Values come from env vars and are
// never exposed to the client or logged.
function sharedKeyForIntegration(
  name: string,
  baseUrl: string | null
): string | null | undefined {
  const normalized = name.toLowerCase();
  const url = (baseUrl ?? "").toLowerCase();
  if (url.includes("x.ai") || normalized.includes("grok")) {
    return process.env.XAI_API_KEY ?? null;
  }
  if (url.includes("openrouter.ai") || normalized.includes("openrouter")) {
    return process.env.OPENROUTER_API_KEY ?? null;
  }
  return null;
}

// Runs one role through the Codebuff agent runtime and normalizes the result
// to the same shape the plain provider path returns. The role's api_keys row
// for "codebuff" (Model Router settings) wins over the server env key.
async function runRoleViaCodebuff(args: {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  runId: string;
  role: Role;
  prompt: string;
  config: ProviderConfig;
  onEvent: (message: string) => void;
}): Promise<CompletionResult & { structured: Record<string, unknown> | null }> {
  const { supabase, projectId, userId, runId, role, prompt, config, onEvent } = args;
  const apiKey = config.apiKey ?? process.env.CODEBUFF_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Codebuff provider selected but no API key configured. Save a Codebuff key in Model Router settings or set CODEBUFF_API_KEY on the server."
    );
  }

  try {
    const agentResult = await runRoleAgent({
      role,
      prompt,
      codebuffApiKey: apiKey,
      supabase,
      projectId,
      onEvent: (event) => {
        if (event.type === "tool_call") onEvent(event.message);
      },
      onCapabilityDenied: () => {
        void logAudit(supabase, {
          projectId,
          userId,
          actor: "system",
          action: "capability.denied",
          target: `${role}/read_files`,
          metadata: { runId },
        });
      },
    });
    return { text: agentResult.text, tokensIn: agentResult.tokensIn, tokensOut: agentResult.tokensOut, structured: agentResult.data };
  } catch (err) {
    await logAudit(supabase, {
      projectId,
      userId,
      actor: role,
      action: "pipeline.step",
      target: runId,
      metadata: { provider: CODEBUFF_PROVIDER, error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function buildRolePrompt(
  memoryText: string,
  userMessage: string,
  priorOutputs: Partial<Record<Role, string>>
): string {
  const sections = [memoryText, `USER MESSAGE:\n${userMessage}`];

  if (priorOutputs.strategist) {
    sections.push(`STRATEGIST DIRECTION:\n${priorOutputs.strategist}`);
  }
  if (priorOutputs.builder) sections.push(`BUILDER OUTPUT:\n${priorOutputs.builder}`);
  if (priorOutputs.analyst) sections.push(`ANALYST REVIEW:\n${priorOutputs.analyst}`);
  if (priorOutputs.qa) sections.push(`QA NOTES:\n${priorOutputs.qa}`);

  return sections.join("\n\n---\n\n");
}

async function persistStep(
  supabase: SupabaseClient,
  runId: string,
  step: {
    role: Role;
    stepOrder: number;
    provider: string;
    model: string;
    input: string;
    output: string;
    tokensIn: number;
    tokensOut: number;
  }
): Promise<PipelineStepResult> {
  const { error } = await supabase.from("pipeline_steps").insert({
    run_id: runId,
    role: step.role,
    step_order: step.stepOrder,
    provider: step.provider,
    model: step.model,
    input: step.input,
    output: step.output,
    tokens_in: step.tokensIn,
    tokens_out: step.tokensOut,
  });

  if (error) throw new Error(`Failed to persist step ${step.role}: ${error.message}`);

  return { ...step, runId };
}

async function applyMemoryUpdate(
  supabase: SupabaseClient,
  projectId: string,
  memory: ProjectMemory,
  update: ReturnType<typeof extractMemoryUpdate>,
  runId: string
) {
  // Even with no extracted update, we still touch updated_at so the Memory
  // Board reflects that a run happened. If there IS an update, merge it in.
  const now = new Date().toISOString();

  const newDecisions = (update?.decisions ?? []).map((text) => ({
    id: randomUUID(),
    text,
    role: "ops" as Role,
    run_id: runId,
    created_at: now,
  }));

  const newIssues = (update?.open_issues ?? []).map((text) => ({
    id: randomUUID(),
    text,
    status: "open" as const,
    created_at: now,
  }));

  const mergedTechStack = Array.from(
    new Set([...(memory.tech_stack ?? []), ...(update?.tech_stack ?? [])])
  );

  const { error } = await supabase
    .from("project_memory")
    .update({
      tech_stack: mergedTechStack,
      decisions: [...(memory.decisions ?? []), ...newDecisions],
      open_issues: [...(memory.open_issues ?? []), ...newIssues],
      updated_at: now,
    })
    .eq("project_id", projectId);

  if (error) throw new Error(`Failed to update project memory: ${error.message}`);
}
