import { createClient } from "@/lib/supabase/server";
import { runPipeline, type PipelineStepResult } from "@/lib/pipeline/run";
import { perfTimer } from "@/lib/perf";

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
