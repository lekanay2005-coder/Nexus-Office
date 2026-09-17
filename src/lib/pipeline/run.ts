import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type ProjectMemory, type Role } from "@/types/db";
import { complete, DEFAULT_PROVIDER_CONFIG, type ProviderConfig } from "@/lib/providers";
import { ROLE_SYSTEM_PROMPTS } from "@/lib/pipeline/roles";
import { formatMemoryForPrompt, extractMemoryUpdate, stripMemoryBlock } from "@/lib/pipeline/memory";
import { extractFilesFromBuilderOutput } from "@/lib/pipeline/extractFiles";
import { randomUUID } from "crypto";

export interface PipelineStepResult {
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
}

export async function runPipeline({
  supabase,
  projectId,
  userId,
  userMessage,
  roleConfig,
}: RunPipelineArgs): Promise<PipelineRunResult> {
  const memory = await loadMemory(supabase, projectId);
  const memoryText = formatMemoryForPrompt(memory);

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
    const strategistConfig = roleConfig?.strategist ?? DEFAULT_PROVIDER_CONFIG;
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

    const { isDirect, body: strategistBody } = parseRoute(strategistResult.text);

    if (isDirect) {
      await supabase
        .from("pipeline_runs")
        .update({ mode: "direct", status: "complete", completed_at: new Date().toISOString() })
        .eq("id", run.id);

      return {
        runId: run.id,
        mode: "direct",
        steps,
        finalMessage: strategistBody,
      };
    }

    // --- Steps 2-5: Builder -> Analyst -> QA -> Ops ---
    const priorOutputs: Partial<Record<Role, string>> = { strategist: strategistBody };
    let stepOrder = 2;

    for (const role of ROLES.filter((r) => r !== "strategist")) {
      const config = roleConfig?.[role] ?? DEFAULT_PROVIDER_CONFIG;
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

    await applyMemoryUpdate(supabase, projectId, memory, memoryUpdate, run.id);

    await supabase
      .from("pipeline_runs")
      .update({ mode: "pipeline", status: "complete", completed_at: new Date().toISOString() })
      .eq("id", run.id);

    return { runId: run.id, mode: "pipeline", steps, finalMessage };
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

function parseRoute(strategistText: string): { isDirect: boolean; body: string } {
  const lines = strategistText.split("\n");
  const firstLine = lines[0]?.trim().toUpperCase() ?? "";
  const rest = lines.slice(1).join("\n").trim();

  if (firstLine.includes("ROUTE: DIRECT") || firstLine.includes("ROUTE:DIRECT")) {
    return { isDirect: true, body: rest || strategistText };
  }
  return { isDirect: false, body: rest || strategistText };
}

function buildRolePrompt(
  memoryText: string,
  userMessage: string,
  priorOutputs: Partial<Record<Role, string>>
): string {
  const sections = [memoryText, `USER MESSAGE:\n${userMessage}`];

  if (priorOutputs.strategist) sections.push(`STRATEGIST PLAN:\n${priorOutputs.strategist}`);
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

  return step;
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
