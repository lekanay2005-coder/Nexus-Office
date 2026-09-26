"use client";

import { useEffect, useState } from "react";
import { ROLES, type Role } from "@/types/db";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/pipeline/roles";
import { MODEL_CATALOG, PROVIDER_LABELS } from "@/lib/providers/catalog";
import { DEFAULT_PROVIDER_CONFIG, type ProviderName } from "@/lib/providers";

interface RoleModelRow {
  role: Role;
  provider: string;
  model: string;
}

const PROVIDERS: ProviderName[] = ["anthropic", "openai", "google"];
const BUILT_IN_PROVIDERS = new Set<string>(PROVIDERS);

// Gateways whose model list we fetch live instead of hardcoding.
const DYNAMIC_MODEL_GATEWAYS = new Set(["openrouter"]);

function isDynamicGateway(name: string): boolean {
  return DYNAMIC_MODEL_GATEWAYS.has(name.toLowerCase());
}

function monthlyLimitText(): string {
  // Display-only mirror of lib/shared-ai's default; the authoritative cap is
  // server-side (NEXUS_FREE_MONTHLY_RUNS).
  return "50";
}

// The Codebuff runtime (same agent framework that powers Freebuff) is
// offered as a per-role provider: it runs the role as a real agent with tool
// use and structured outputs instead of a single LLM call.
const CODEBUFF_PROVIDER = "codebuff";
const CODEBUFF_MODELS = [
  { model: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (via Codebuff)" },
  { model: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (via Codebuff)" },
  { model: "openai/gpt-5-mini", label: "GPT-5 Mini (via Codebuff)" },
  { model: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash (via Codebuff)" },
];

export default function ModelRouterPanel({
  projectId,
  initialRoleModels,
  initialApiKeyProviders,
  customIntegrationNames,
}: {
  projectId: string;
  initialRoleModels: RoleModelRow[];
  initialApiKeyProviders: ProviderName[];
  customIntegrationNames: string[];
}) {
  const [assignments, setAssignments] = useState<Record<Role, RoleModelRow>>(() => {
    const map = {} as Record<Role, RoleModelRow>;
    for (const role of ROLES) {
      const existing = initialRoleModels.find((r) => r.role === role);
      map[role] = existing ?? {
        role,
        provider: DEFAULT_PROVIDER_CONFIG.provider,
        model: DEFAULT_PROVIDER_CONFIG.model,
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

  // Live model lists for dynamic gateways (OpenRouter), keyed by integration
  // name. Fetched once per unique gateway the project has an integration for.
  const [dynamicModels, setDynamicModels] = useState<
    Record<string, { models: { id: string; label: string }[]; error?: string; loading: boolean }>
  >({});

  useEffect(() => {
    const gateways = customIntegrationNames.filter(isDynamicGateway);
    for (const gw of gateways) {
      setDynamicModels((prev) => {
        if (prev[gw]) return prev;
        (async () => {
          try {
            const res = await fetch(
              `/api/projects/${projectId}/integrations/models?integration=${encodeURIComponent(gw)}`
            );
            const data = await res.json().catch(() => null);
            if (res.ok && data?.models?.length) {
              setDynamicModels((p) => ({ ...p, [gw]: { models: data.models, loading: false } }));
            } else {
              setDynamicModels((p) => ({
                ...p,
                [gw]: { models: [], loading: false, error: data?.error ?? `HTTP ${res.status}` },
              }));
            }
          } catch (err) {
            setDynamicModels((p) => ({
              ...p,
              [gw]: {
                models: [],
                loading: false,
                error: err instanceof Error ? err.message : "fetch failed",
              },
            }));
          }
        })();
        return { ...prev, [gw]: { models: [], loading: true } };
      });
    }
  }, [customIntegrationNames, projectId]);

  async function saveAssignment(role: Role, provider: string, model: string) {
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
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Model Router</h2>
          <span
            className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400"
            title="Roles without an explicit assignment run on Nexus Office's shared AI key, capped at the Free-tier monthly allowance. Add your own key to remove the cap."
          >
            Using Nexus Office&apos;s shared AI (Free tier)
          </span>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          Choose which provider and model handles each role in the pipeline. Roles left on
          the default run on our shared free-tier key ({monthlyLimitText()} runs/month);
          add your own key in Integrations to go unlimited.
        </p>
        <div className="space-y-2">
          {ROLES.map((role) => {
            const current = assignments[role];
            const isBuiltIn = BUILT_IN_PROVIDERS.has(current.provider);
            const isCodebuff = current.provider === CODEBUFF_PROVIDER;
            const modelsForProvider = isBuiltIn
              ? MODEL_CATALOG.filter((m) => m.provider === current.provider)
              : isCodebuff
                ? CODEBUFF_MODELS
                : [];
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
                    const provider = e.target.value;
                    const firstModel =
                      provider === CODEBUFF_PROVIDER
                        ? CODEBUFF_MODELS[0].model
                        : MODEL_CATALOG.find((m) => m.provider === provider)?.model ?? "";
                    saveAssignment(role, provider, firstModel);
                  }}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                >
                  <optgroup label="Built-in">
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                      </option>
                    ))}
                    <option value={CODEBUFF_PROVIDER}>Codebuff agents</option>
                  </optgroup>
                  {customIntegrationNames.length > 0 && (
                    <optgroup label="Integrations">
                      {customIntegrationNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {isBuiltIn ? (
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
                ) : isCodebuff ? (
                  <select
                    value={
                      CODEBUFF_MODELS.some((m) => m.model === current.model)
                        ? current.model
                        : CODEBUFF_MODELS[0].model
                    }
                    onChange={(e) => saveAssignment(role, CODEBUFF_PROVIDER, e.target.value)}
                    className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                  >
                    {CODEBUFF_MODELS.map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : isDynamicGateway(current.provider) ? (
                  (() => {
                    const entry = dynamicModels[current.provider];
                    if (!entry || entry.loading) {
                      return (
                        <span className="flex-1 text-xs text-neutral-500">
                          Loading model list…
                        </span>
                      );
                    }
                    if (entry.error || entry.models.length === 0) {
                      return (
                        <span className="flex-1 text-xs text-amber-400">
                          {entry.error ?? "No models returned"} — check the integration in
                          the Integrations panel
                        </span>
                      );
                    }
                    return (
                      <select
                        value={
                          entry.models.some((m) => m.id === current.model)
                            ? current.model
                            : entry.models[0].id
                        }
                        onChange={(e) => saveAssignment(role, current.provider, e.target.value)}
                        className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                      >
                        {entry.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    );
                  })()
                ) : (
                  <input
                    value={current.model}
                    onChange={(e) =>
                      setAssignments((prev) => ({
                        ...prev,
                        [role]: { ...prev[role], model: e.target.value },
                      }))
                    }
                    onBlur={(e) => saveAssignment(role, current.provider, e.target.value)}
                    placeholder="Model name for this integration"
                    className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
                  />
                )}

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
