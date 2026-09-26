"use client";

import { useCallback, useEffect, useState } from "react";

// Role Permissions (Addendum 3): least-privilege capability toggles per
// role, enforced server-side before any role output is applied, plus the
// per-project "Require approval for production actions" setting.

type Role = "strategist" | "builder" | "analyst" | "qa" | "ops";
type Capability =
  | "read_files"
  | "write_files"
  | "read_project_memory"
  | "write_project_memory"
  | "trigger_deploy"
  | "trigger_github_commit";

const ROLES: Role[] = ["strategist", "builder", "analyst", "qa", "ops"];

const CAPABILITIES: [Capability, string][] = [
  ["read_files", "Read files"],
  ["write_files", "Write files"],
  ["read_project_memory", "Read memory"],
  ["write_project_memory", "Write memory"],
  ["trigger_deploy", "Trigger deploy"],
  ["trigger_github_commit", "GitHub commit"],
];

const DEFAULTS: Record<Role, Capability[]> = {
  strategist: ["read_project_memory", "read_files"],
  builder: ["write_files", "read_project_memory"],
  analyst: ["read_files", "read_project_memory"],
  qa: ["read_files", "read_project_memory"],
  ops: ["write_project_memory", "trigger_deploy", "trigger_github_commit"],
};

const ROLE_COLORS: Record<Role, string> = {
  strategist: "var(--role-strategist)",
  builder: "var(--role-builder)",
  analyst: "var(--role-analyst)",
  qa: "var(--role-qa)",
  ops: "var(--role-ops)",
};

const ROLE_GLYPHS: Record<Role, string> = {
  strategist: "🧭",
  builder: "🔨",
  analyst: "🔍",
  qa: "🛡",
  ops: "🚀",
};

export default function PermissionsPanel({ projectId }: { projectId: string }) {
  const [capabilities, setCapabilities] = useState<Record<Role, Capability[]> | null>(null);
  const [requireApproval, setRequireApproval] = useState(true);
  // Addendum 17: review-before-merge for pipeline runs (default off =
  // auto-merge, matching the existing no-manual-step behavior).
  const [requireMergeApproval, setRequireMergeApproval] = useState(false);
  const [savingApproval, setSavingApproval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [capRes, settingsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/capabilities`),
          fetch(`/api/projects/${projectId}/settings`),
        ]);
        const capData = await capRes.json();
        const settingsData = await settingsRes.json();
        if (!capRes.ok) {
          setError(capData.error ?? "Failed to load permissions");
          return;
        }
        setCapabilities(capData.capabilities);
        if (settingsRes.ok) {
          setRequireApproval(settingsData.settings?.requireApproval !== false);
          setRequireMergeApproval(settingsData.settings?.requireMergeApproval === true);
        }
      } catch {
        setError("Failed to load permissions");
      }
    })();
  }, [projectId]);

  const toggle = useCallback(
    (role: Role, capability: Capability) => {
      setCapabilities((prev) => {
        if (!prev) return prev;
        const granted = prev[role].includes(capability)
          ? prev[role].filter((c) => c !== capability)
          : [...prev[role], capability];
        return { ...prev, [role]: granted };
      });
    },
    []
  );

  async function save() {
    if (!capabilities) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/capabilities`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilities }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save permissions");
      } else {
        setCapabilities(data.capabilities);
        setNotice("Permissions saved");
      }
    } catch {
      setError("Failed to save permissions");
    }
    setSaving(false);
  }

  function resetDefaults() {
    setCapabilities({ ...DEFAULTS });
    setNotice("Defaults loaded — press Save to apply");
  }

  async function toggleApproval(checked: boolean) {
    setSavingApproval(true);
    setError(null);
    const previous = requireApproval;
    setRequireApproval(checked);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApproval: checked }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save setting");
        setRequireApproval(previous);
      }
    } catch {
      setError("Failed to save setting");
      setRequireApproval(previous);
    }
    setSavingApproval(false);
  }

  // Addendum 17: per-project code-merge approval toggle (Settings →
  // Perms). Applied to pipeline-run merges specifically, complementing
  // the deploy/commit gate above.
  async function toggleMergeApproval(checked: boolean) {
    setSavingApproval(true);
    setError(null);
    const previous = requireMergeApproval;
    setRequireMergeApproval(checked);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireMergeApproval: checked }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save setting");
        setRequireMergeApproval(previous);
      }
    } catch {
      setError("Failed to save setting");
      setRequireMergeApproval(previous);
    }
    setSavingApproval(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="mb-1 text-lg font-semibold">Role Permissions</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Least-privilege controls: what each role is allowed to do in this project. Enforced
        server-side before any role output is applied.
      </p>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-3 text-sm text-emerald-400">{notice}</p>}

      <div className="glass-panel flex items-center justify-between gap-4 rounded-lg p-4">
        <div>
          <div className="text-sm font-medium">Require approval for production actions</div>
          <p className="mt-0.5 text-xs text-neutral-500">
            GitHub commits, production deploys, and integration deletion ask for explicit approval
            first. Every approval or rejection lands in the Audit Log.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center" aria-label="Require approval for production actions">
          <input
            type="checkbox"
            checked={requireApproval}
            disabled={savingApproval}
            onChange={(e) => toggleApproval(e.target.checked)}
            className="h-4 w-4 accent-[var(--role-qa)]"
          />
        </label>
      </div>

      {/* Addendum 17: review-before-merge toggle. */}
      <div className="glass-panel mt-3 flex items-center justify-between gap-4 rounded-lg p-4">
        <div>
          <div className="text-sm font-medium">Require approval before merging code changes</div>
          <p className="mt-0.5 text-xs text-neutral-500">
            Every pipeline run writes to an isolated snapshot first. With this on, changes wait for
            your review — you see the per-file diff and approve or discard before anything touches
            your files. Off (default): runs auto-merge, with the diff still shown in chat and
            &quot;Undo last run&quot; always available in Code Canvas.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center" aria-label="Require approval before merging code changes">
          <input
            type="checkbox"
            checked={requireMergeApproval}
            disabled={savingApproval}
            onChange={(e) => toggleMergeApproval(e.target.checked)}
            className="h-4 w-4 accent-[var(--role-qa)]"
          />
        </label>
      </div>

      <h3 className="mb-3 mt-6 text-sm font-semibold text-neutral-400">Capabilities per role</h3>

      {capabilities === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}

      {capabilities !== null && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLES.map((role) => (
              <div
                key={role}
                className="glass-panel rounded-lg p-3"
                style={{ borderTop: `2px solid ${ROLE_COLORS[role]}` }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full text-[12px]"
                    style={{
                      background: `color-mix(in srgb, ${ROLE_COLORS[role]} 15%, transparent)`,
                      color: ROLE_COLORS[role],
                    }}
                    aria-hidden
                  >
                    {ROLE_GLYPHS[role]}
                  </span>
                  <span className="text-sm font-medium" style={{ color: ROLE_COLORS[role] }}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {CAPABILITIES.map(([capability, label]) => (
                    <label key={capability} className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        checked={capabilities[role].includes(capability)}
                        onChange={() => toggle(role, capability)}
                        className="h-3.5 w-3.5 accent-[var(--role-qa)]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={resetDefaults}
              className="rounded bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10"
            >
              Reset to defaults
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded bg-[var(--role-qa)] px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save permissions"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
