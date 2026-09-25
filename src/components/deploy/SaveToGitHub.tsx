"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApprovalFlow } from "@/components/common/ApprovalDialog";
import type { SyncConflict } from "@/lib/deploy/githubSync";
import RepoPicker from "./RepoPicker";

type Status =
  | { kind: "idle"; validating?: boolean }
  | { kind: "reconnect" }
  | { kind: "conflicts"; conflicts: SyncConflict[] }
  | { kind: "success"; url: string }
  // Addendum 13 section 5: pre-push validation failed and couldn't be
  // auto-fixed — surfaced with the exact issues instead of a silent skip.
  | { kind: "validation_failed"; message: string }
  | { kind: "error"; message: string };

export default function SaveToGitHub({
  projectId,
  githubRepo,
  onRepoChange,
}: {
  projectId: string;
  githubRepo: string | null;
  onRepoChange: (repo: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [resolutions, setResolutions] = useState<Record<string, "mine" | "theirs">>({});
  const [diffOpen, setDiffOpen] = useState<string | null>(null);

  // Approval-gated GitHub commits (Addendum 3): a 409 APPROVAL_REQUIRED
  // response raises the confirm dialog and retries with confirmed=true.
  const { fetchWithApproval, dialogEl } = useApprovalFlow(projectId);

  async function handleSave(withResolutions?: Record<string, "mine" | "theirs">) {
    setSaving(true);
    setStatus({ kind: "idle", validating: true });

    // Addendum 13 section 5: show the validation step explicitly — the user
    // should understand a check is happening, not just a delay.
    const { res, data } = await fetchWithApproval(`/api/projects/${projectId}/github/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutions: withResolutions ?? {} }),
    });
    setSaving(false);

    if (data.cancelled) {
      setStatus({ kind: "idle" });
      return;
    }
    if (!res.ok) {
      if (data.error === "RECONNECT_GITHUB") setStatus({ kind: "reconnect" });
      else if (data.status === "validation_failed")
        setStatus({ kind: "validation_failed", message: data.message as string });
      else setStatus({ kind: "error", message: (data.error as string) ?? "Save failed" });
      return;
    }

    if (data.status === "conflicts") {
      setStatus({ kind: "conflicts", conflicts: data.conflicts as SyncConflict[] });
      return;
    }

    setStatus({ kind: "success", url: data.url as string });
    setResolutions({});
  }

  async function handleReconnect() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/projects/${projectId}`,
        scopes: "read:user user:email repo",
      },
    });
  }

  function pickResolution(path: string, choice: "mine" | "theirs") {
    setResolutions((prev) => ({ ...prev, [path]: choice }));
  }

  return (
    <section>
      {dialogEl}
      <h2 className="mb-1 text-lg font-semibold">Save to GitHub</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Push the project&apos;s files to a connected repo as a single commit, with automatic
        conflict resolution when possible.
      </p>

      <div className="glass-panel space-y-3 rounded-lg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm">
            {githubRepo ? (
              <>
                Connected: <span className="font-medium">{githubRepo}</span>
              </>
            ) : (
              "No repo connected"
            )}
          </span>
          <button
            onClick={() => setBrowsing((v) => !v)}
            className="shrink-0 rounded bg-white/5 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/10"
          >
            {browsing ? "Close" : "Connect a Repo"}
          </button>
        </div>

        {browsing && (
          <RepoPicker
            onPick={(fullName) => {
              onRepoChange(fullName);
              setBrowsing(false);
            }}
            onClose={() => setBrowsing(false)}
            onReconnect={handleReconnect}
          />
        )}

        <button
          onClick={() => handleSave()}
          disabled={saving || !githubRepo}
          className="w-full rounded-md bg-[var(--role-strategist)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Validating, then pushing…" : "Save to GitHub"}
        </button>

        {saving && (
          <p className="text-xs text-neutral-500" aria-live="polite">
            Validating files before push…
          </p>
        )}

        {status.kind === "validation_failed" && (
          <div className="rounded border border-red-900/60 bg-red-950/30 p-3 text-xs">
            <p className="font-medium text-red-300">Push blocked — validation failed</p>
            <p className="mt-1 leading-relaxed text-red-200/90">{status.message}</p>
            <p className="mt-1 text-red-200/60">
              Fix the flagged files in Code Canvas (or ask Office Chat to fix them),
              then push again.
            </p>
          </div>
        )}

        {status.kind === "reconnect" && (
          <div className="rounded bg-amber-600/10 p-2 text-xs text-amber-300">
            Your GitHub connection is missing or expired.{" "}
            <button onClick={handleReconnect} className="font-medium underline">
              Reconnect GitHub
            </button>
          </div>
        )}

        {status.kind === "error" && (
          <p className="text-xs text-red-400">{status.message}</p>
        )}

        {status.kind === "success" && (
          <p className="text-xs text-emerald-400">
            Pushed —{" "}
            <a href={status.url} target="_blank" rel="noreferrer" className="underline">
              view commit on GitHub
            </a>
          </p>
        )}

        {status.kind === "conflicts" && (
          <div className="space-y-2 rounded border border-amber-600/30 bg-amber-600/5 p-3">
            <p className="text-xs text-amber-300">
              {status.conflicts.length} file{status.conflicts.length === 1 ? "" : "s"} changed on
              both sides since your last sync — pick which version to keep for each.
            </p>
            {status.conflicts.map((c) => (
              <div key={c.path} className="rounded bg-black/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-neutral-300">{c.path}</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => pickResolution(c.path, "mine")}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        resolutions[c.path] === "mine"
                          ? "bg-[var(--role-strategist)] text-white"
                          : "bg-white/5 text-neutral-300 hover:bg-white/10"
                      }`}
                    >
                      Keep mine
                    </button>
                    <button
                      onClick={() => pickResolution(c.path, "theirs")}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        resolutions[c.path] === "theirs"
                          ? "bg-[var(--role-strategist)] text-white"
                          : "bg-white/5 text-neutral-300 hover:bg-white/10"
                      }`}
                    >
                      Keep GitHub&apos;s
                    </button>
                    <button
                      onClick={() => setDiffOpen(diffOpen === c.path ? null : c.path)}
                      className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/10"
                    >
                      {diffOpen === c.path ? "Hide diff" : "View diff"}
                    </button>
                  </div>
                </div>
                {diffOpen === c.path && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[10px] uppercase text-neutral-500">Mine</p>
                      <pre className="max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-neutral-300">
                        {c.ours}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] uppercase text-neutral-500">GitHub&apos;s</p>
                      <pre className="max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-neutral-300">
                        {c.theirs ?? "(file deleted on GitHub)"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={() => handleSave(resolutions)}
              disabled={
                saving || status.conflicts.some((c) => !resolutions[c.path])
              }
              className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Pushing…" : "Resolve & Push"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
