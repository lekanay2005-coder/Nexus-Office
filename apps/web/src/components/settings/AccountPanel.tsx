"use client";

import { useEffect, useState } from "react";

// Addendum 9 Phase 1: Account Settings — editable Display Name field.
// The name shown in the nav, Memory Board, Audit Log, and GitHub commit
// authorship lives here.

export default function AccountPanel() {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/display-name");
        if (res.ok) {
          const data = await res.json();
          setDisplayName(data.displayName ?? "");
        }
      } catch {
        // panel still renders; save will surface any real problem
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setStatus(null);
    const res = await fetch("/api/me/display-name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    setStatus(res.ok ? "Saved." : (data.error as string) ?? "Failed to save");
  }

  return (
    <section className="glass-panel rounded-lg p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-200">Account</h3>
      <p className="mb-3 text-xs text-neutral-500">
        How Nexus Office addresses you — in the workspace UI and as the author
        name on commits pushed to GitHub.
      </p>
      {loading ? (
        <p className="text-xs text-neutral-600">Loading…</p>
      ) : (
        <div className="flex gap-2">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && displayName.trim() && save()}
            placeholder="Your display name"
            maxLength={60}
            aria-label="Display name"
            className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            onClick={save}
            disabled={saving || !displayName.trim()}
            className="rounded bg-[var(--role-strategist)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {status && <p className="mt-2 text-xs text-neutral-400">{status}</p>}
    </section>
  );
}
