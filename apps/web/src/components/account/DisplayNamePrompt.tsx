"use client";

import { useEffect, useState } from "react";
import NexusLogo from "@/components/brand/NexusLogo";
import { createClient } from "@/lib/supabase/client";
import { createNexusClient } from "@nexus-office/api-client";

const nexus = createNexusClient();

// Addendum 9 Phase 1: one-time "What should we call you?" modal. Mounted
// once per workspace; self-gates by fetching the profile and only showing
// while no display name is set. Pre-fills with the GitHub username for
// GitHub signups (editable). Skipping dismisses for the session — the
// prompt returns on the next visit until a name is saved.

type Gate = "loading" | "needed" | "done";

export default function DisplayNamePrompt() {
  const [gate, setGate] = useState<Gate>("loading");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await nexus.getDisplayName();
        if (cancelled) return;
        if (!data.needsDisplayName) {
          setGate("done");
          return;
        }
        // GitHub signups carry identity metadata; email signups fall back
        // to the email local-part as a starting suggestion.
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
        const suggested =
          (typeof meta.user_name === "string" && meta.user_name) ||
          (typeof meta.preferred_username === "string" && meta.preferred_username) ||
          (typeof meta.name === "string" && meta.name) ||
          (typeof user?.email === "string" ? user.email.split("@")[0] : "") ||
          "";
        setName(suggested);
        setGate("needed");
      } catch {
        // stay hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate !== "needed") return null;

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await nexus.saveDisplayName(name);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Failed to save");
      return;
    }
    setSaving(false);
    setGate("done");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your display name"
    >
      <div className="glass-panel w-full max-w-sm rounded-xl p-8">
        <div className="mb-5 flex flex-col items-center text-center">
          <NexusLogo surface="card" glow className="mb-3" />
          <h2 className="text-xl font-semibold text-neutral-100">
            What should we call you?
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            Your display name shows in the nav, Memory Board, Audit Log — and as
            the author on your GitHub commits.
          </p>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Your name"
          autoFocus
          maxLength={60}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="flex-1 rounded-md bg-[var(--role-strategist)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setGate("done")}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
