"use client";

import { useEffect, useRef, useState } from "react";
import SaveToGitHub from "./SaveToGitHub";
import { useApprovalFlow } from "@/components/common/ApprovalDialog";
import type { Deploy, DeployStatus, Integration, Project } from "@/types/db";

const STATUS_STYLES: Record<DeployStatus, string> = {
  pending: "bg-neutral-700 text-neutral-200",
  building: "bg-amber-600/30 text-amber-300",
  ready: "bg-emerald-600/30 text-emerald-300",
  error: "bg-red-600/30 text-red-300",
};

export default function DeployDesk({
  project,
  initialDeploys,
  hostingIntegrations,
}: {
  project: Project;
  initialDeploys: Deploy[];
  hostingIntegrations: Integration[];
}) {
  const [githubRepo, setGithubRepo] = useState(project.github_repo ?? "");
  const [vercelProjectId, setVercelProjectId] = useState(project.vercel_project_id ?? "");
  const [hostingIntegrationId, setHostingIntegrationId] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [deploys, setDeploys] = useState<Deploy[]>(initialDeploys);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState(project.last_synced_to_github_at);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Approval-gated production deploys (Addendum 3): a 409 APPROVAL_REQUIRED
  // response raises the confirm dialog and retries with confirmed=true.
  const { fetchWithApproval, dialogEl } = useApprovalFlow(project.id);

  async function saveConfig() {
    setSavingConfig(true);
    setError(null);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_repo: githubRepo, vercel_project_id: vercelProjectId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save deploy settings");
    }
    setSavingConfig(false);
  }

  async function handleRepoChange(repo: string) {
    setGithubRepo(repo);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_repo: repo }),
    });
  }

  async function handleDeploy() {
    setDeploying(true);
    setError(null);

    const { res, data } = await fetchWithApproval(`/api/projects/${project.id}/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostingIntegrationId: hostingIntegrationId || undefined }),
    });
    setDeploying(false);

    if (data.cancelled) return;
    if (!res.ok) {
      setError((data.error as string) ?? "Deploy failed");
      return;
    }
    setDeploys((prev) => [data.deploy as Deploy, ...prev]);
    setLastSynced(new Date().toISOString());
  }

  async function refreshDeploy(deployId: string) {
    const res = await fetch(`/api/projects/${project.id}/deploys/${deployId}/refresh`, {
      method: "POST",
    });
    if (!res.ok) return;
    const data = await res.json();
    setDeploys((prev) => prev.map((d) => (d.id === deployId ? data.deploy : d)));
  }

  // Auto-poll while any deploy is still in flight.
  useEffect(() => {
    const inFlight = deploys.filter((d) => d.status === "building" || d.status === "pending");
    if (inFlight.length === 0) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      inFlight.forEach((d) => refreshDeploy(d.id));
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploys.map((d) => `${d.id}:${d.status}`).join(",")]);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-8 text-neutral-100">
      {dialogEl}
      <SaveToGitHub
        projectId={project.id}
        githubRepo={githubRepo || null}
        onRepoChange={handleRepoChange}
      />

      <section>
        <h2 className="mb-1 text-lg font-semibold">Deploy Desk</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Push the current file tree to GitHub and track the resulting deploy. Add a
          GitHub/Vercel token in Settings → Connections first (or add hosting integrations
          below for other targets).
        </p>

        <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-xs text-neutral-500">
            GitHub repo (owner/repo)
            <input
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="your-org/your-repo"
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
            />
          </label>
          <label className="block text-xs text-neutral-500">
            Vercel project ID (optional, for live status)
            <input
              value={vercelProjectId}
              onChange={(e) => setVercelProjectId(e.target.value)}
              placeholder="prj_xxxxxxxx"
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
            />
          </label>
          <label className="block text-xs text-neutral-500">
            Deploy target
            <select
              value={hostingIntegrationId}
              onChange={(e) => setHostingIntegrationId(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="">Vercel (via GitHub integration, default)</option>
              {hostingIntegrations.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-neutral-600">
              {lastSynced
                ? `Last synced to GitHub: ${new Date(lastSynced).toLocaleString()}`
                : "Not synced to GitHub yet"}
            </span>
            <button
              onClick={saveConfig}
              disabled={savingConfig}
              className="rounded bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
            >
              {savingConfig ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>

        <button
          onClick={handleDeploy}
          disabled={deploying || !githubRepo.trim()}
          className="mt-4 w-full rounded-md bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {deploying ? "Deploying…" : "Deploy Now"}
        </button>

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-400">Deploy History</h3>
        <ul className="space-y-2">
          {deploys.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[d.status]}`}
                  >
                    {d.hosting_integration_id && d.status === "ready" ? "triggered" : d.status}
                  </span>
                  {d.hosting_integration_id && (
                    <span className="text-[11px] text-neutral-600">
                      check your host&apos;s dashboard
                    </span>
                  )}
                  {d.branch && (
                    <span className="text-xs text-neutral-500">
                      {d.branch}@{d.github_commit_sha?.slice(0, 7)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-600">
                  {new Date(d.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.deployment_url && (
                  <a
                    href={d.deployment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-violet-400 hover:text-violet-300"
                  >
                    View
                  </a>
                )}
                {(d.status === "building" || d.status === "pending") && (
                  <button
                    onClick={() => refreshDeploy(d.id)}
                    className="text-xs text-neutral-400 hover:text-neutral-200"
                  >
                    Refresh
                  </button>
                )}
              </div>
            </li>
          ))}
          {deploys.length === 0 && (
            <li className="text-sm text-neutral-500">No deploys yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
