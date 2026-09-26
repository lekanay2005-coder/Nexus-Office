"use client";

import { useState } from "react";
import { createNexusClient } from "@nexus-office/api-client";

const nexus = createNexusClient();

type ConnectionProvider = "github" | "vercel";

const LABELS: Record<ConnectionProvider, string> = {
  github: "GitHub Personal Access Token",
  vercel: "Vercel API Token",
};

const HELP: Record<ConnectionProvider, string> = {
  github: "Needs repo scope. Create one at github.com/settings/tokens.",
  vercel: "Create one at vercel.com/account/tokens.",
};

const PROVIDERS: ConnectionProvider[] = ["github", "vercel"];

export default function ConnectionsPanel({
  initialConfigured,
}: {
  initialConfigured: ConnectionProvider[];
}) {
  const [configured, setConfigured] = useState<Set<ConnectionProvider>>(
    new Set(initialConfigured)
  );
  const [drafts, setDrafts] = useState<Record<ConnectionProvider, string>>({
    github: "",
    vercel: "",
  });
  const [saving, setSaving] = useState<ConnectionProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(provider: ConnectionProvider) {
    const key = drafts[provider].trim();
    if (!key) return;
    setSaving(provider);
    setError(null);

    try {
      await nexus.saveApiKey(provider, key);
      setConfigured((prev) => new Set(prev).add(provider));
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${LABELS[provider]}`);
    }
    setSaving(null);
  }

  async function remove(provider: ConnectionProvider) {
    setSaving(provider);
    try {
      await nexus.deleteApiKey(provider);
      setConfigured((prev) => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    } catch {
      // key stays listed; user can retry
    }
    setSaving(null);
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Connections</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Needed for Deploy Desk to push to GitHub and check Vercel deploy status.
      </p>
      <div className="space-y-2">
        {PROVIDERS.map((provider) => {
          const isConfigured = configured.has(provider);
          return (
            <div
              key={provider}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="w-56 shrink-0 text-sm font-medium">{LABELS[provider]}</span>
                {isConfigured ? (
                  <>
                    <span className="flex-1 text-xs text-emerald-400">Configured</span>
                    <button
                      onClick={() => remove(provider)}
                      disabled={saving === provider}
                      className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="password"
                      value={drafts[provider]}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [provider]: e.target.value }))
                      }
                      placeholder="Paste token"
                      className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
                    />
                    <button
                      onClick={() => save(provider)}
                      disabled={saving === provider || !drafts[provider].trim()}
                      className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </>
                )}
              </div>
              <p className="mt-1 pl-0 text-[11px] text-neutral-600">{HELP[provider]}</p>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
