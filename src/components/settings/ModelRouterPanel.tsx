"use client";

import { useState } from "react";
import { ROLES, type Role } from "@/types/db";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/pipeline/roles";
import { MODEL_CATALOG, PROVIDER_LABELS } from "@/lib/providers/catalog";
import type { ProviderName } from "@/lib/providers";

interface RoleModelRow {
  role: Role;
  provider: ProviderName;
  model: string;
}

const PROVIDERS: ProviderName[] = ["anthropic", "openai", "google"];

export default function ModelRouterPanel({
  projectId,
  initialRoleModels,
  initialApiKeyProviders,
}: {
  projectId: string;
  initialRoleModels: RoleModelRow[];
  initialApiKeyProviders: ProviderName[];
}) {
  const [assignments, setAssignments] = useState<Record<Role, RoleModelRow>>(() => {
    const map = {} as Record<Role, RoleModelRow>;
    for (const role of ROLES) {
      const existing = initialRoleModels.find((r) => r.role === role);
      map[role] = existing ?? {
        role,
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
      };
    }
    return map;
  });
  const [savingRole, setSavingRole] = useState<Role | null>(null);
  const [configuredKeys, setConfiguredKeys] = useState<Set<ProviderName>>(
    new Set(initialApiKeyProviders)
  );
  const [keyDrafts, setKeyDrafts] = useState<Record<ProviderName, string>>({
    anthropic: "",
    openai: "",
    google: "",
  });
  const [savingKey, setSavingKey] = useState<ProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveAssignment(role: Role, provider: ProviderName, model: string) {
    setSavingRole(role);
    setError(null);
    setAssignments((prev) => ({ ...prev, [role]: { role, provider, model } }));

    const res = await fetch(`/api/projects/${projectId}/role-models`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, provider, model }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed to save ${ROLE_LABELS[role]} model`);
    }
    setSavingRole(null);
  }

  async function saveKey(provider: ProviderName) {
    const key = keyDrafts[provider].trim();
    if (!key) return;
    setSavingKey(provider);
    setError(null);

    const res = await fetch("/api/settings/api-keys", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key }),
    });

    if (res.ok) {
      setConfiguredKeys((prev) => new Set(prev).add(provider));
      setKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed to save ${PROVIDER_LABELS[provider]} key`);
    }
    setSavingKey(null);
  }

  async function removeKey(provider: ProviderName) {
    setSavingKey(provider);
    const res = await fetch("/api/settings/api-keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    if (res.ok) {
      setConfiguredKeys((prev) => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    }
    setSavingKey(null);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-6 py-8 text-neutral-100">
      <section>
        <h2 className="mb-1 text-lg font-semibold">Model Router</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Choose which provider and model handles each role in the pipeline.
        </p>
        <div className="space-y-2">
          {ROLES.map((role) => {
            const current = assignments[role];
            const modelsForProvider = MODEL_CATALOG.filter(
              (m) => m.provider === current.provider
            );
            return (
              <div
                key={role}
                className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: ROLE_COLORS[role] }}
                >
                  {ROLE_LABELS[role][0]}
                </span>
                <span className="w-24 shrink-0 text-sm font-medium">{ROLE_LABELS[role]}</span>

                <select
                  value={current.provider}
                  onChange={(e) => {
                    const provider = e.target.value as ProviderName;
                    const firstModel =
                      MODEL_CATALOG.find((m) => m.provider === provider)?.model ?? "";
                    saveAssignment(role, provider, firstModel);
                  }}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>

                <select
                  value={current.model}
                  onChange={(e) => saveAssignment(role, current.provider, e.target.value)}
                  className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                >
                  {modelsForProvider.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.label}
                    </option>
                  ))}
                </select>

                {savingRole === role && (
                  <span className="text-[11px] text-neutral-500">Saving…</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">API Keys</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Your keys are encrypted at rest and only used to call that provider on your
          behalf. Leave a provider unconfigured to fall back to the app&apos;s default key.
        </p>
        <div className="space-y-2">
          {PROVIDERS.map((provider) => {
            const configured = configuredKeys.has(provider);
            return (
              <div
                key={provider}
                className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
              >
                <span className="w-20 shrink-0 text-sm font-medium">
                  {PROVIDER_LABELS[provider]}
                </span>
                {configured ? (
                  <>
                    <span className="flex-1 text-xs text-emerald-400">Key configured</span>
                    <button
                      onClick={() => removeKey(provider)}
                      disabled={savingKey === provider}
                      className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="password"
                      placeholder={`${PROVIDER_LABELS[provider]} API key`}
                      value={keyDrafts[provider]}
                      onChange={(e) =>
                        setKeyDrafts((prev) => ({ ...prev, [provider]: e.target.value }))
                      }
                      className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
                    />
                    <button
                      onClick={() => saveKey(provider)}
                      disabled={savingKey === provider || !keyDrafts[provider].trim()}
                      className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
