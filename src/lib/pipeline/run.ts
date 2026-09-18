import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type ProjectMemory, type Role } from "@/types/db";
import { complete, DEFAULT_PROVIDER_CONFIG, type ProviderConfig, type ProviderName } from "@/lib/providers";
import { ROLE_SYSTEM_PROMPTS } from "@/lib/pipeline/roles";
import {
  formatMemoryForPrompt,
  extractMemoryUpdate,
  stripMemoryBlock,
  parseStrategistOutput,
} from "@/lib/pipeline/memory";
import { extractFilesFromBuilderOutput } from "@/lib/pipeline/extractFiles";
import { decryptSecret } from "@/lib/crypto";
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
}

export async function runPipeline({
  supabase,
  projectId,
  userId,
  userMessage,
  roleConfig,
  onStep,
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

  const steps: PipelineStepResult[] = [];

  try {
    // --- Step 1: Strategist decides route ---
    const strategistConfig = effectiveRoleConfig.strategist ?? DEFAULT_PROVIDER_CONFIG;
    const strategistPrompt = `${memoryText}\n\nUSER MESSAGE:\n${userMessage}`;
    const strategistResult = await complete(strategistConfig, {
      system: ROLE_SYSTEM_PROMPTS.strategist,
      prompt: strategistPrompt,
    });

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

    const { needsFullPipeline, direction } = parseStrategistOutput(strategistResult.text);
    const rolesToRun: Role[] = needsFullPipeline
      ? ["builder", "analyst", "qa", "ops"]
      : ["ops"];

    // --- Remaining steps: either straight to Ops, or Builder -> Analyst -> QA -> Ops ---
    const priorOutputs: Partial<Record<Role, string>> = { strategist: direction };
    let stepOrder = 2;

    for (const role of rolesToRun) {
      const config = effectiveRoleConfig[role] ?? DEFAULT_PROVIDER_CONFIG;
      const prompt = buildRolePrompt(memoryText, userMessage, priorOutputs);

      const result = await complete(config, {
        system: ROLE_SYSTEM_PROMPTS[role],
        prompt,
      });

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
      priorOutputs[role] = result.text;

      // Builder output may contain files destined for the Code Canvas.
      if (role === "builder") {
        const files = extractFilesFromBuilderOutput(result.text);
        if (files.length) {
          await supabase.from("files").upsert(
            files.map((f) => ({
              project_id: projectId,
              path: f.path,
              content: f.content,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "project_id,path" }
          );
        }
      }
    }

    const opsOutput = priorOutputs.ops ?? "";
    const memoryUpdate = extractMemoryUpdate(opsOutput);
    const finalMessage = stripMemoryBlock(opsOutput);
    const mode = needsFullPipeline ? "pipeline" : "direct";

    // Every run ends with Ops and updates memory before returning, whether
    // it took the short path (Strategist -> Ops) or the full one.
    await applyMemoryUpdate(supabase, projectId, memory, memoryUpdate, run.id);

    await supabase
      .from("pipeline_runs")
      .update({ mode, status: "complete", completed_at: new Date().toISOString() })
      .eq("id", run.id);

    return { runId: run.id, mode, steps, finalMessage };
  } catch (err) {
    await supabase
      .from("pipeline_runs")
      .update({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
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

  const config: Partial<Record<Role, ProviderConfig>> = {};
  for (const role of ROLES) {
    const row = rowByRole.get(role);
    const provider = row?.provider ?? DEFAULT_PROVIDER_CONFIG.provider;
    const integration = integrationsByName.get(provider);

    if (integration) {
      let apiKey: string | undefined;
      try {
        apiKey = decryptSecret(integration.api_key_encrypted);
      } catch {
        // Fall through with no key — the custom provider call will fail
        // clearly rather than silently using a stale/undecryptable one.
      }
      config[role] = {
        provider,
        model: row?.model ?? DEFAULT_PROVIDER_CONFIG.model,
        apiKey,
        baseUrl: integration.base_url ?? undefined,
      };
      continue;
    }

    config[role] = {
      provider,
      model: row?.model ?? DEFAULT_PROVIDER_CONFIG.model,
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
