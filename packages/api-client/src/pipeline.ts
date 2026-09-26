import { NexusClient, ApiError } from "./config";

// src/pipeline.ts — Office Chat pipeline calls (SSE streaming client).

export interface PipelineStepEvent {
  role: string;
  stepOrder?: number;
  output: string | null;
  model?: string | null;
}

export interface PipelineIsolationSummary {
  applied: boolean;
  status: "applied" | "ready" | "rejected" | "none";
  files: string[];
}

export interface PipelineDone {
  runId: string;
  mode: "pipeline" | "direct";
  finalMessage: string;
  isolation?: PipelineIsolationSummary | null;
}

export type StepHandler = (step: PipelineStepEvent) => void;

/**
 * Runs the 5-role pipeline, invoking `onStep` as each role's card completes.
 * Uses the same SSE stream the web UI consumes.
 */
export async function runPipeline(
  client: NexusClient,
  projectId: string,
  message: string,
  onStep?: StepHandler
): Promise<PipelineDone> {
  const res = await client.requestRaw("POST", "/api/pipeline", {
    projectId,
    message,
  }, { Accept: "text/event-stream" });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    const payload = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(
      res.status,
      payload.error ?? "Pipeline failed",
      payload.code,
      data
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: PipelineDone | null = null;
  let errored: string | null = null;

  while (true) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if (event.type === "step") {
        const step = event.step as Record<string, unknown>;
        onStep?.({
          role: step.role as string,
          stepOrder: step.stepOrder as number | undefined,
          output: (step.output as string | null) ?? null,
          model: (step.model as string | null) ?? null,
        });
      } else if (event.type === "done") {
        done = {
          runId: event.runId as string,
          mode: event.mode as PipelineDone["mode"],
          finalMessage: event.finalMessage as string,
          isolation: (event.isolation as PipelineIsolationSummary | null) ?? null,
        };
      } else if (event.type === "error") {
        errored = event.message as string;
      }
    }
  }
  if (errored) throw new ApiError(500, errored, "pipeline_error");
  if (!done) throw new ApiError(500, "Pipeline stream ended without a result", "pipeline_error");
  return done;
}

/** One run's full transcript (steps nested), by run id. */
export async function getPipelineRun(
  client: NexusClient,
  projectId: string,
  runId: string
): Promise<
  | {
      id: string;
      user_message: string;
      mode: string;
      status: string;
      error: string | null;
      created_at: string;
      pipeline_steps: {
        id: string;
        role: string;
        step_order: number;
        output: string | null;
        model: string | null;
      }[];
    }
  | null
> {
  const runs = await listPipelineRuns(client, projectId);
  return runs.find((r) => r.id === runId) ?? null;
}

/** Full pipeline transcript for a project: runs with their nested steps. */
export async function listPipelineRuns(
  client: NexusClient,
  projectId: string
): Promise<
  {
    id: string;
    user_message: string;
    mode: string;
    status: string;
    error: string | null;
    created_at: string;
    pipeline_steps: {
      id: string;
      role: string;
      step_order: number;
      output: string | null;
      model: string | null;
    }[];
  }[]
> {
  const data = await client.expect<{
    runs: {
      id: string;
      user_message: string;
      mode: string;
      status: string;
      error: string | null;
      created_at: string;
      pipeline_steps: {
        id: string;
        role: string;
        step_order: number;
        output: string | null;
        model: string | null;
      }[];
    }[];
  }>("GET", `/api/projects/${projectId}/runs`);
  return data.runs;
}
