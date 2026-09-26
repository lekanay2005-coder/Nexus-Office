"use client";

// Addendum 13 Phase 2: primary project entry point. In-app repo creation is
// gone (per spec) — this picker lists the user's personal GitHub account and
// every org they belong to, and importing a repo creates the Nexus Office
// project linked to it. The "create it on GitHub first" hint links out to
// github.com/new with a refresh button.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createNexusClient } from "@nexus-office/api-client";

const nexus = createNexusClient();
// (no other imports needed — tour anchors are plain attributes)

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

export default function RepoImportPicker() {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [activeOwner, setActiveOwner] = useState("");
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<ErrorState | null>(null);

  const loadRepos = useCallback(async (owner: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await nexus.client.request<{
        repos?: RepoSummary[];
        error?: string;
      }>("GET", `/api/github/owners?owner=${encodeURIComponent(owner)}`);
      if (!data || data.error) {
        setError(
          data?.error === "RECONNECT_GITHUB"
            ? { kind: "reconnect" }
            : { kind: "message", message: data?.error ?? "Failed to list repos" }
        );
      } else {
        setRepos(data.repos ?? []);
      }
    } catch {
      setError({ kind: "message", message: "Failed to list repos" });
    }
    setLoading(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await nexus.client.request<{
        owners?: Owner[];
        activeOwner?: string;
        error?: string;
      }>("GET", "/api/github/owners");
      if (!data || data.error) {
        setError(
          data?.error === "RECONNECT_GITHUB"
            ? { kind: "reconnect" }
            : { kind: "message", message: data?.error ?? "Failed to list accounts" }
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
  }, [loadRepos]);

  // Load on mount once; the fetch chain owns all state updates.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void Promise.resolve().then(() => loadAll());
  }, [loadAll]);

  // Importing = create the Nexus Office project linked to the picked repo.
  async function importRepo(fullName: string) {
    if (importing) return;
    setImporting(fullName);
    try {
      const project = await nexus.connectRepo(fullName);
      router.push(`/projects/${project.id}`);
      return;
    } catch (err) {
      setError({
        kind: "message",
        message: err instanceof Error ? err.message : "Failed to import repo",
      });
    }
    setImporting(null);
  }

  const filtered = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="glass-panel rounded-lg p-4" data-tour="repo-picker">
      <h2 className="text-sm font-semibold">Connect a repo</h2>
      <p className="mb-3 mt-1 text-xs text-neutral-500">
        Which repo or org do you want to work on? Its files open in Code Canvas and
        every tool here links to it.
      </p>

      {owners && owners.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="GitHub account or organization">
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
              {o.type === "Organization" && <span className="ml-1 text-[10px] opacity-70">org</span>}
            </button>
          ))}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your repos…"
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />

      {loading && <p className="mt-2 text-xs text-neutral-500">Loading repos…</p>}
      {error?.kind === "message" && <p className="mt-2 text-xs text-red-400">{error.message}</p>}

      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {!loading &&
          filtered.map((r) => (
            <button
              key={r.fullName}
              onClick={() => importRepo(r.fullName)}
              disabled={importing !== null}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
            >
              <span>
                {r.fullName} {r.private && <span className="text-neutral-600">(private)</span>}
              </span>
              <span className="text-[10px] text-neutral-500">
                {importing === r.fullName ? "Importing…" : "Import"}
              </span>
            </button>
          ))}
        {!loading && owners && filtered.length === 0 && !error && (
          <p className="text-xs text-neutral-600">No repos under {activeOwner} yet.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3 text-xs text-neutral-500">
        <span>Don&apos;t see your repo? Create it on GitHub first, then refresh this list.</span>
        <a
          href="https://github.com/new"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-white/5 px-2 py-1 text-neutral-300 hover:bg-white/10"
        >
          Create on GitHub ↗
        </a>
        <button
          onClick={() => loadAll()}
          className="rounded bg-white/5 px-2 py-1 text-neutral-300 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {error?.kind === "reconnect" && (
        <div className="mt-3 rounded bg-amber-600/10 p-2 text-xs text-amber-300">
          Your GitHub connection is missing or expired. Reconnect from Settings →
          Connections (or sign out and back in with GitHub) to pick a repo.
        </div>
      )}
    </div>
  );
}
