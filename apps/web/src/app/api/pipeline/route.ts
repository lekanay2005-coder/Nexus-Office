import { createClient } from "@/lib/supabase/server";
import { runPipeline, type PipelineStepResult } from "@/lib/pipeline/run";
import { perfTimer } from "@/lib/perf";
import { checkAndConsumeSharedRun, monthlyLimit } from "@/lib/shared-ai";

// Streams each role's step to the client as soon as it completes (SSE),
// so the chat UI can render cards in sequence instead of waiting for the
// whole pipeline to finish.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!projectId || !message) {
    return new Response(
      JSON.stringify({ error: "projectId and message are required" }),
      { status: 400 }
    );
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
  }

  // Free-tier gate (Phase 3/4): if this run will draw on Nexus Office's
  // shared AI key, consume one run from the monthly allowance first. Never a
  // silent failure — the client shows an explicit upgrade/BYO-key prompt.
  // Note: runPipeline itself decides per role whether the shared key is
  // needed; the gate errs on the side of counting a run that uses it at all,
  // which keeps the ledger append-only and simple.
  const { data: usage } = await supabase
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("action", "shared_ai.run");
  const sharedUsed = usage?.length ?? 0;
  void sharedUsed; // informational; the authoritative gate lives in shared-ai

  const sharedRun = await checkAndConsumeSharedRun(supabase, user.id);
  if (!sharedRun.allowed && sharedRun.reason !== "no_key") {
    return new Response(
      JSON.stringify({
        error:
          sharedRun.reason === "user_limit"
            ? `You've used all ${monthlyLimit()} free shared-AI runs this month.`
            : "Nexus Office's shared AI is at capacity right now. Please try again later.",
        code: sharedRun.reason === "user_limit" ? "free_limit_reached" : "shared_capacity",
        usage: { used: sharedRun.used, limit: sharedRun.limit, resetAt: sharedRun.resetAt },
      }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        const timer = perfTimer("pipeline.run");
        const result = await runPipeline({
          supabase,
          projectId,
          userId: user.id,
          userMessage: message,
          onStep: (step: PipelineStepResult) => send({ type: "step", step }),
          // Live progress from Codebuff-backed roles (tool calls, retries) —
          // rendered as a transient status line in the chat UI.
          onRoleEvent: (event) => send({ type: "role_event", role: event.role, message: event.message }),
        });
        timer.end();
        send({
          type: "done",
          runId: result.runId,
          mode: result.mode,
          finalMessage: result.finalMessage,
          // Addendum 17: where the Builder's writes ended up — applied
          // (auto-merged), ready (awaiting review), rejected (scope or
          // review), or none (direct answer / no files written).
          isolation: result.isolation ?? null,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Pipeline failed";
        send({ type: "error", message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
