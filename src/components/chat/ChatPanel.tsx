"use client";

import { useRef, useState } from "react";
import RoleMessage from "./RoleMessage";
import type { PipelineStep } from "@/types/db";

export interface RunWithSteps {
  id: string;
  user_message: string;
  mode: "pipeline" | "direct";
  status: "running" | "complete" | "error";
  error: string | null;
  created_at: string;
  pipeline_steps: PipelineStep[];
}

export default function ChatPanel({
  projectId,
  initialRuns,
  onFilesChanged,
}: {
  projectId: string;
  initialRuns: RunWithSteps[];
  onFilesChanged?: () => void;
}) {
  const [runs, setRuns] = useState<RunWithSteps[]>(initialRuns);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || pending) return;

    setInput("");
    setPending(true);
    setError(null);

    // Optimistic placeholder run so the user sees their message immediately.
    const tempId = `pending-${Date.now()}`;
    setRuns((prev) => [
      ...prev,
      {
        id: tempId,
        user_message: message,
        mode: "pipeline",
        status: "running",
        error: null,
        created_at: new Date().toISOString(),
        pipeline_steps: [],
      },
    ]);

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Pipeline failed");

      const steps: PipelineStep[] = data.steps.map((s: PipelineStep) => ({
        ...s,
        run_id: data.runId,
      }));

      setRuns((prev) =>
        prev.map((r) =>
          r.id === tempId
            ? {
                id: data.runId,
                user_message: message,
                mode: data.mode,
                status: "complete",
                error: null,
                created_at: new Date().toISOString(),
                pipeline_steps: steps,
              }
            : r
        )
      );

      if (data.mode === "pipeline") onFilesChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pipeline failed";
      setError(msg);
      setRuns((prev) =>
        prev.map((r) => (r.id === tempId ? { ...r, status: "error", error: msg } : r))
      );
    } finally {
      setPending(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {runs.length === 0 && (
          <p className="text-sm text-neutral-500">
            Say something to your team. Simple questions get a direct answer from the
            Strategist; anything requiring real work runs the full 5-role pipeline.
          </p>
        )}

        {runs.map((run) => (
          <div key={run.id} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-lg rounded-tr-none bg-violet-600 px-3 py-2 text-sm text-white">
                {run.user_message}
              </div>
            </div>

            {run.status === "running" && (
              <p className="pl-11 text-xs text-neutral-500 animate-pulse">
                Pipeline running…
              </p>
            )}

            {run.status === "error" && (
              <p className="pl-11 text-xs text-red-400">Error: {run.error}</p>
            )}

            {[...run.pipeline_steps]
              .sort((a, b) => a.step_order - b.step_order)
              .map((step) => (
                <RoleMessage
                  key={step.id}
                  role={step.role}
                  model={step.model}
                  content={
                    step.role === "ops"
                      ? stripMemoryBlockClient(step.output ?? "")
                      : step.output ?? ""
                  }
                />
              ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-800 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your team anything…"
          disabled={pending}
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function stripMemoryBlockClient(text: string): string {
  return text.replace(/```memory-update[\s\S]*?```/, "").trim();
}
