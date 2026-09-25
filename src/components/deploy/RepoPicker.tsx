"use client";

import { useCallback, useEffect, useState } from "react";

// Addendum 9 Phase 1: GitHub org/repo picker. Lists the user's personal
// account AND every organization they belong to; picking an owner swaps the
// repo listing to that account/org. Includes the same create-repo flow as
// before, now owner-aware (repos are created under the active owner).

interface Owner {
  login: string;
  type: "User" | "Organization";
}

interface RepoSummary {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
}

type ErrorState = { kind: "reconnect" } | { kind: "message"; message: string };

export default function RepoPicker({
  onPick,
  onClose,
  onReconnect,
}: {
  onPick: (fullName: string) => void;
  onClose: () => void;
  onReconnect?: () => void;
}) {
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [activeOwner, setActiveOwner] = useState<string>("");
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [error, setError] = useState<ErrorState | null>(null);

  const loadRepos = useCallback(async (owner: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/github/owners?owner=${encodeURIComponent(owner)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "RECONNECT_GITHUB"
            ? { kind: "reconnect" }
            : { kind: "message", message: data.error ?? "Failed to list repos" }
        );
      } else {
        setRepos(data.repos ?? []);
      }
    } catch {
      setError({ kind: "message", message: "Failed to list repos" });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/github/owners");
        const data = await res.json();
        if (!res.ok) {
          setError(
            data.error === "RECONNECT_GITHUB"
              ? { kind: "reconnect" }
              : { kind: "message", message: data.error ?? "Failed to list accounts" }
          );
          setLoading(false);
          return;
        }
        setOwners(data.owners ?? []);
        setActiveOwner(data.activeOwner ?? data.owners?.[0]?.login ?? "");
        await loadRepos(data.activeOwner ?? data.owners?.[0]?.login ?? "");
      } catch {
        setError({ kind: "message", message: "Failed to list accounts" });
        setLoading(false);
      }
    })();
  }, [loadRepos]);

  async function createRepo() {
    if (!newRepoName.trim() || !activeOwner) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/github/owners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: activeOwner, name: newRepoName.trim(), private: newRepoPrivate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "RECONNECT_GITHUB"
            ? { kind: "reconnect" }
            : { kind: "message", message: data.error ?? "Failed to create repo" }
        );
      } else {
        onPick(data.repo.fullName as string);
      }
    } catch {
      setError({ kind: "message", message: "Failed to create repo" });
    }
    setCreating(false);
  }

  const filtered = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2 border-t border-white/10 pt-3">
      {/* Owner switcher: personal account first, then orgs. */}
      {owners && owners.length > 0 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="GitHub account or organization">
          {owners.map((o) => (
            <button
              key={o.login}
              role="tab"
              aria-selected={activeOwner === o.login}
              onClick={() => {
                setActiveOwner(o.login);
                loadRepos(o.login);
              }}
              className={`rounded-full px-2.5 py-1 text-xs ${
                activeOwner === o.login
                  ? "bg-[var(--role-strategist)] text-white"
                  : "bg-white/5 text-neutral-300 hover:bg-white/10"
              }`}
            >
              {o.login}
              {o.type === "Organization" && (
                <span className="ml-1 text-[10px] opacity-70">org</span>
              )}
            </button>
          ))}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${activeOwner || "your"}'s repos…`}
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />

      {loading && <p className="text-xs text-neutral-500">Loading repos…</p>}

      {error?.kind === "message" && <p className="text-xs text-red-400">{error.message}</p>}

      <div className="max-h-40 space-y-1 overflow-y-auto">
        {!loading &&
          filtered.map((r) => (
            <button
              key={r.fullName}
              onClick={() => onPick(r.fullName)}
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-white/5"
            >
              {r.fullName} {r.private && <span className="text-neutral-600">(private)</span>}
            </button>
          ))}
        {!loading && owners && filtered.length === 0 && (
          <p className="text-xs text-neutral-600">No repos under {activeOwner} yet.</p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 pt-2">
        <input
          value={newRepoName}
          onChange={(e) => setNewRepoName(e.target.value)}
          placeholder={`New repo name (under ${activeOwner || "…"})`}
          className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-500"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={newRepoPrivate}
            onChange={(e) => setNewRepoPrivate(e.target.checked)}
          />
          Private
        </label>
        <button
          onClick={createRepo}
          disabled={creating || !newRepoName.trim() || !activeOwner}
          className="rounded bg-[var(--role-strategist)] px-2 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </div>

      {error?.kind === "reconnect" && (
        <ReconnectHint onReconnect={onReconnect} onClose={onClose} />
      )}
    </div>
  );
}

function ReconnectHint({ onReconnect, onClose }: { onReconnect?: () => void; onClose: () => void }) {
  if (onReconnect) {
    return (
      <div className="rounded bg-amber-600/10 p-2 text-xs text-amber-300">
        Your GitHub connection is missing or expired.{" "}
        <button
          onClick={onReconnect}
          className="font-medium underline decoration-dotted underline-offset-1"
        >
          Reconnect GitHub
        </button>{" "}
        — this will open the GitHub OAuth flow and resume right here once done.
      </div>
    );
  }
  return (
    <div className="rounded bg-amber-600/10 p-2 text-xs text-amber-300">
      Your GitHub connection is missing or expired. Reconnect from Deploy Desk&apos;s
      Save to GitHub panel first.{" "}
      <button onClick={onClose} className="underline">
        Close picker
      </button>
    </div>
  );
}
