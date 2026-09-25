"use client";

import { useRef, useState } from "react";
import RoleMessage from "./RoleMessage";
import RelayTrack from "./RelayTrack";
import type { PipelineStep, Role } from "@/types/db";
import { stripMemoryBlock, stripStrategistBlock, parseStrategistOutput } from "@/lib/pipeline/memory";

const SHORT_SEQUENCE: Role[] = ["strategist", "ops"];
const FULL_SEQUENCE: Role[] = ["strategist", "builder", "analyst", "qa", "ops"];

export interface RunWithSteps {
  id: string;
  user_message: string;
  mode: "pipeline" | "direct";
  status: "running" | "complete" | "error";
  error: string | null;
  created_at: string;
  pipeline_steps: PipelineStep[];
  // Client-only: the full role sequence this run will follow, known once
  // the Strategist's step arrives (drives the RelayTrack visualization).
  relaySequence?: Role[];
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
  // Live progress line from Codebuff-backed roles (e.g. "builder →
  // project_read_file(src/app/page.tsx)") shown while a run is in flight.
  const [roleEvent, setRoleEvent] = useState<string | null>(null);
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
        relaySequence: SHORT_SEQUENCE,
      },
    ]);

    let sawFullPipeline = false;
    let stepCounter = 0;

    function retitleRun(realId: string) {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === tempId
            ? { ...r, id: realId, pipeline_steps: r.pipeline_steps.map((s) => ({ ...s, run_id: realId })) }
            : r
        )
      );
    }

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Pipeline failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentRunId = tempId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim());

          if (event.type === "step") {
            if (currentRunId === tempId) {
              currentRunId = event.step.runId;
              retitleRun(currentRunId);
            }
            if (event.step.role === "builder") sawFullPipeline = true;

            const step: PipelineStep = {
              id: `${currentRunId}-${stepCounter++}`,
              run_id: currentRunId,
              role: event.step.role,
              step_order: event.step.stepOrder,
              provider: event.step.provider,
              model: event.step.model,
              input: event.step.input,
              output: event.step.output,
              tokens_in: event.step.tokensIn,
              tokens_out: event.step.tokensOut,
              created_at: new Date().toISOString(),
            };

            const relaySequence =
              step.role === "strategist"
                ? parseStrategistOutput(step.output ?? "").needsFullPipeline
                  ? FULL_SEQUENCE
                  : SHORT_SEQUENCE
                : undefined;

            setRuns((prev) =>
              prev.map((r) =>
                r.id === currentRunId
                  ? {
                      ...r,
                      pipeline_steps: [...r.pipeline_steps, step],
                      relaySequence: relaySequence ?? r.relaySequence,
                    }
                  : r
              )
            );
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          } else if (event.type === "role_event") {
            setRoleEvent(`${event.role}: ${event.message}`);
          } else if (event.type === "done") {
            setRoleEvent(null);
            setRuns((prev) =>
              prev.map((r) => (r.id === currentRunId ? { ...r, mode: event.mode, status: "complete" } : r))
            );
            if (sawFullPipeline) onFilesChanged?.();
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pipeline failed";
      setError(msg);
      setRuns((prev) =>
        prev.map((r) => (r.id === tempId || r.status === "running" ? { ...r, status: "error", error: msg } : r))
      );
    } finally {
      setPending(false);
      setRoleEvent(null);
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

            {run.status !== "error" && (
              <div className="pl-11">
                <RelayTrack
                  sequence={run.relaySequence ?? SHORT_SEQUENCE}
                  completedCount={run.pipeline_steps.length}
                  running={run.status === "running"}
                />
              </div>
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
                  content={displayContent(step)}
                />
              ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {pending && roleEvent && (
        <p className="px-4 pb-1 text-xs text-neutral-500">{roleEvent}</p>
      )}

      {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="glass-panel flex gap-2 border-x-0 border-b-0 p-3">
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

function displayContent(step: PipelineStep): string {
  const text = step.output ?? "";
  if (step.role === "strategist") return stripStrategistBlock(text);
  if (step.role === "ops") return stripMemoryBlock(text);
  return text;
}
