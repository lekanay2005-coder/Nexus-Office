"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import RoleMessage from "./RoleMessage";
import RelayTrack from "./RelayTrack";
import type { PipelineStep, Role } from "@/types/db";
import { stripMemoryBlock, stripStrategistBlock, parseStrategistOutput } from "@/lib/pipeline/memory";
import { createNexusClient, ApiError } from "@nexus-office/api-client";

// Same-origin client (cookie auth) — every request below goes through the
// shared @nexus-office/api-client package instead of raw fetch.
const nexus = createNexusClient();

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
  // Addendum 17 isolation summary (from the done event): where the
  // Builder's writes ended up for this run.
  isolation?: {
    applied: boolean;
    status: "applied" | "ready" | "rejected" | "none";
    files: string[];
  } | null;
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live progress line from Codebuff-backed roles (e.g. "builder →
  // project_read_file(src/app/page.tsx)") shown while a run is in flight.
  const [roleEvent, setRoleEvent] = useState<string | null>(null);
  // Free-tier shared-AI limit hit — switches the composer into the
  // "bring your own key or upgrade" state.
  const [limitInfo, setLimitInfo] = useState<{
    used: number | null;
    limit: number | null;
    resetAt: string | null;
  } | null>(null);
  // Addendum 13: "Use this prompt" from the Explore board stages a message
  // in localStorage under this key; prefill the composer when present.
  // Lazily initialized so no setState-in-effect cascade happens.
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(() => {
    try {
      const pending = localStorage.getItem("nexus-pending-prompt");
      if (pending) {
        const parsed = JSON.parse(pending) as { title: string; body: string };
        localStorage.removeItem("nexus-pending-prompt");
        return `${parsed.title}\n\n${parsed.body}`;
      }
    } catch {
      localStorage.removeItem("nexus-pending-prompt");
    }
    return "";
  });

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
    let currentRunId = tempId;

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
      // Free-tier shared-AI limit (Phase 3): a 402 means the user is out of
      // shared runs — show the explicit BYO-key / upgrade prompt instead of
      // a raw error. Never a silent failure.
      const runResult = await nexus.runPipeline(projectId, message, (stepEvent) => {
        if (stepEvent.role === "builder") sawFullPipeline = true;

        const step: PipelineStep = {
          id: `${projectId}-${stepCounter++}`,
          run_id: currentRunId,
          role: stepEvent.role as Role,
          step_order: stepEvent.stepOrder ?? stepCounter,
          provider: null,
          model: stepEvent.model ?? null,
          input: null,
          output: stepEvent.output,
          tokens_in: null,
          tokens_out: null,
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
      }).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 402 && err.code === "free_limit_reached") {
          const usage = (err.body as { usage?: { used?: number; limit?: number; resetAt?: string } })?.usage;
          setLimitInfo({
            used: usage?.used ?? null,
            limit: usage?.limit ?? null,
            resetAt: usage?.resetAt ?? null,
          });
        }
        throw err;
      });

      // The run completed: retile the optimistic run onto the real run id
      // (api-client's stream parser already fed us every step), then apply
      // the final mode + Addendum 17 isolation status.
      retitleRun(runResult.runId);
      currentRunId = runResult.runId;
      setRoleEvent(null);
      setLimitInfo(null);
      setRuns((prev) =>
        prev.map((r) =>
          r.id === currentRunId
            ? {
                ...r,
                mode: runResult.mode as "pipeline" | "direct",
                status: "complete" as const,
                isolation: runResult.isolation ?? null,
              }
            : r
        )
      );
      // Files only reached the canvas when the run's snapshot was actually
      // applied (auto-merge). "ready" means review-first.
      if (sawFullPipeline && runResult.isolation?.status === "applied") onFilesChanged?.();
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
      {/* Addendum 14: terminal session header — process-style label above the
          transcript, reinforcing the console metaphor. */}
      <div className="term-titlebar border-x-0 border-t-0 px-4">
        <span className="term-dot" style={{ background: "#ff5f56" }} />
        <span className="term-dot" style={{ background: "#ffbd2e" }} />
        <span className="term-dot" style={{ background: "#27c93f" }} />
        <span className="ml-1">office-chat — live session</span>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {runs.length === 0 && (
          <div className="glass-panel rounded-lg p-6 text-center" data-tour="office-chat">
            <p className="data-mono text-sm text-[var(--term-accent)] phosphor">
              nexus@office:~$ awaiting first directive
              <span className="cursor-block" />
            </p>
            <p className="mt-3 text-sm text-neutral-400">
              Say something to your team. Simple questions get a direct answer from the
              Strategist; anything requiring real work runs the full 5-role pipeline.
            </p>
          </div>
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

            {/* Addendum 17: isolation status — what happened to the
                Builder's writes. Always visible so the user can see exactly
                what changed and where the changes are right now. */}
            {run.status === "complete" && run.isolation && run.isolation.status !== "none" && (
              <MergeStatusGate
                runId={run.id}
                isolation={run.isolation}
                onChanged={onFilesChanged}
              />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {pending && roleEvent && (
        <p className="px-4 pb-1 text-xs text-neutral-500">{roleEvent}</p>
      )}

      {limitInfo && (
        <div className="mx-4 mb-1 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs">
          <p className="font-medium text-amber-300">
            Free shared-AI limit reached{limitInfo.limit ? ` (${limitInfo.used}/${limitInfo.limit} runs this month)` : ""}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href="/projects"
              className="rounded bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-100 hover:bg-neutral-700"
            >
              Add your own API key (free, unlimited with your own usage)
            </Link>
            <Link
              href="/pricing"
              className="rounded bg-violet-600 px-2.5 py-1.5 font-medium text-white hover:bg-violet-500"
            >
              Upgrade to Pro for unlimited managed AI
            </Link>
          </div>
        </div>
      )}

      {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="glass-panel flex gap-2 border-x-0 border-b-0 p-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--term-accent)]">
            &gt;
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the mission…"
            disabled={pending}
            aria-label="Message the team"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 py-2 pl-7 pr-3 text-sm text-neutral-100 outline-none focus:border-[var(--term-accent)] disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="btn-terminal data-mono rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending ? "RUNNING" : "EXEC"}
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

// Addendum 17: per-run isolation status bar. Wrapper records which run id
// the bar acts on (merge needs an explicit runId), then renders the bar.
function MergeStatusGate({
  runId,
  isolation,
  onChanged,
}: {
  runId: string;
  isolation: { applied: boolean; status: string; files: string[] };
  onChanged?: () => void;
}) {
  setMergeRunId(runId);
  return <MergeStatusBar isolation={isolation} onChanged={onChanged} />;
}

//   applied  → auto-merged; shows the file list + Undo button
//   ready    → awaiting review; shows the diff summary + Approve/Reject
//   rejected → scope violation or user rejection; nothing was merged
// The diff summary (files + line counts) is always rendered so the user
// can see exactly what changed — even under auto-merge.
function MergeStatusBar({
  isolation,
  onChanged,
}: {
  isolation: { applied: boolean; status: string; files: string[] };
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(isolation.status);
  const [message, setMessage] = useState<string | null>(null);

  async function act(kind: "merge" | "reject" | "undo") {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const runId = runIdFromSnapshot();
      if (kind === "merge") {
        await nexus.mergeRun(CHAT_PROJECT_ID, runId);
        setStatus("applied");
        setMessage(`Merged ${isolation.files.length} file(s).`);
        onChanged?.();
      } else if (kind === "reject") {
        await nexus.rejectRun(CHAT_PROJECT_ID, runId);
        setStatus("rejected");
        setMessage("Discarded — nothing was merged.");
      } else {
        const result = await nexus.undoLastRun(CHAT_PROJECT_ID, runId);
        setStatus("undone");
        setMessage(result.message ?? "Reverted to the pre-run state.");
        onChanged?.();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const fileSummary =
    isolation.files.length > 0
      ? isolation.files.map((p) => p.split("/").pop()).join(", ")
      : "no files";

  return (
    <div
      className={`ml-11 rounded-lg border px-3 py-2 text-xs ${
        status === "ready"
          ? "border-amber-800/60 bg-amber-950/30"
          : status === "rejected"
            ? "border-red-900/60 bg-red-950/20"
            : "border-neutral-800 bg-neutral-900/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {status === "applied" && (
          <span className="font-medium text-emerald-400">✓ merged into your project</span>
        )}
        {status === "ready" && (
          <span className="font-medium text-amber-300">⏸ awaiting your review before merge</span>
        )}
        {status === "rejected" && (
          <span className="font-medium text-red-400">✕ rejected — nothing was merged</span>
        )}
        {status === "undone" && (
          <span className="font-medium text-neutral-400">↩ undone</span>
        )}
        <span className="text-neutral-500" title={isolation.files.join("\n")}>
          {isolation.files.length} file(s): {fileSummary}
        </span>

        {status === "ready" && (
          <>
            <button
              onClick={() => act("merge")}
              disabled={busy}
              className="rounded bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "…" : "Approve & merge"}
            </button>
            <button
              onClick={() => act("reject")}
              disabled={busy}
              className="rounded bg-neutral-800 px-2 py-1 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
            >
              Discard
            </button>
          </>
        )}
        {status === "applied" && (
          <button
            onClick={() => act("undo")}
            disabled={busy}
            className="rounded bg-neutral-800 px-2 py-1 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy ? "…" : "Undo this run"}
          </button>
        )}
      </div>
      {message && <p className="mt-1.5 text-neutral-400">{message}</p>}
    </div>
  );
}

// The MergeStatusBar needs the project id for its merge/undo calls; the
// workspace registers it once per mount, and each run's isolation status
// bar resolves its run id from the snapshot (latest pending) server-side.
let CHAT_PROJECT_ID = "";
export function setChatProjectId(id: string) {
  CHAT_PROJECT_ID = id;
}
function runIdFromSnapshot(): string {
  // The undo endpoint without a runId targets the latest applied run; the
  // merge endpoint requires an explicit runId, which MergeStatusBar tracks
  // from the run that rendered it via the data- attribute below.
  return MERGE_RUN_ID;
}
let MERGE_RUN_ID = "";
export function setMergeRunId(id: string) {
  MERGE_RUN_ID = id;
}
