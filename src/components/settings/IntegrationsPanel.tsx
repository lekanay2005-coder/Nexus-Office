"use client";

import { useState } from "react";
import { useApprovalFlow } from "@/components/common/ApprovalDialog";
import type { Integration, IntegrationType } from "@/types/db";

const BASE_URL_PRESETS: { label: string; url: string; type: IntegrationType; hint?: string }[] = [
  {
    label: "Grok (xAI)",
    url: "https://api.x.ai/v1",
    type: "ai_provider",
    hint: "Single provider — Grok models only",
  },
  {
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1",
    type: "ai_provider",
    hint: "One key → hundreds of models from many providers",
  },
  { label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", type: "ai_provider", hint: "Single provider — Gemini models" },
  { label: "Together AI", url: "https://api.together.xyz/v1", type: "ai_provider" },
  { label: "OpenAI", url: "https://api.openai.com/v1", type: "ai_provider" },
  { label: "Anthropic", url: "https://api.anthropic.com/v1", type: "ai_provider" },
];

export default function IntegrationsPanel({
  projectId,
  initialIntegrations,
}: {
  projectId: string;
  initialIntegrations: Integration[];
}) {
  const [integrations, setIntegrations] = useState<Integration[]>(initialIntegrations);
  const [showForm, setShowForm] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>(
    {}
  );
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deleting an integration is a risky production action (Addendum 3): a
  // 409 APPROVAL_REQUIRED response raises the confirm dialog first.
  const { fetchWithApproval, dialogEl } = useApprovalFlow(projectId);

  async function handleAdd(data: {
    type: IntegrationType;
    name: string;
    base_url: string;
    api_key: string;
    extra_config: string;
  }) {
    setError(null);
    let extraConfig = {};
    if (data.extra_config.trim()) {
      try {
        extraConfig = JSON.parse(data.extra_config);
      } catch {
        setError("Extra Config must be valid JSON");
        return;
      }
    }

    const res = await fetch(`/api/projects/${projectId}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: data.type,
        name: data.name,
        base_url: data.base_url,
        api_key: data.api_key,
        extra_config: extraConfig,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      setError(result.error ?? "Failed to add integration");
      return;
    }
    setIntegrations((prev) => [...prev.filter((i) => i.name !== result.integration.name), result.integration]);
    setShowForm(false);
  }

  async function handleDelete(integrationId: string) {
    const { res, data } = await fetchWithApproval(
      `/api/projects/${projectId}/integrations/${integrationId}`,
      { method: "DELETE" }
    );
    if (data.cancelled) return;
    if (res.ok) setIntegrations((prev) => prev.filter((i) => i.id !== integrationId));
  }

  async function handleTest(integrationId: string) {
    setTesting(integrationId);
    const res = await fetch(`/api/projects/${projectId}/integrations/${integrationId}/test`, {
      method: "POST",
    });
    const result = await res.json();
    setTestResults((prev) => ({ ...prev, [integrationId]: result }));
    setTesting(null);
  }

  return (
    <section>
      {dialogEl}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded bg-[var(--role-strategist)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          {showForm ? "Cancel" : "Add Integration"}
        </button>
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        Add any AI provider or hosting service by name and base URL — no code changes needed.
        AI providers show up in the Model Router; hosting integrations show up in Deploy Desk.
      </p>

      {showForm && <AddIntegrationForm onSubmit={handleAdd} error={error} />}

      <div className="grid gap-2 sm:grid-cols-2">
        {integrations.map((integration) => {
          const result = testResults[integration.id];
          return (
            <div
              key={integration.id}
              className="glass-panel rounded-lg p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{integration.name}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase text-neutral-400">
                      {integration.type === "ai_provider" ? "AI" : "Hosting"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-neutral-500">
                    {integration.base_url ?? "no base URL"}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(integration.id)}
                  className="shrink-0 text-xs text-neutral-600 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => handleTest(integration.id)}
                  disabled={testing === integration.id}
                  className="rounded bg-white/5 px-2 py-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {testing === integration.id ? "Testing…" : "Test Connection"}
                </button>
                {result && (
                  <span className={`text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {result.message}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {integrations.length === 0 && !showForm && (
          <p className="text-sm text-neutral-500">No integrations added yet.</p>
        )}
      </div>
    </section>
  );
}

function AddIntegrationForm({
  onSubmit,
  error,
}: {
  onSubmit: (data: {
    type: IntegrationType;
    name: string;
    base_url: string;
    api_key: string;
    extra_config: string;
  }) => void;
  error: string | null;
}) {
  const [type, setType] = useState<IntegrationType>("ai_provider");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [extraConfig, setExtraConfig] = useState("");
  const [saving, setSaving] = useState(false);

  const presets = BASE_URL_PRESETS.filter((p) => p.type === type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (type === "ai_provider" && !apiKey.trim()) return;
    setSaving(true);
    await onSubmit({ type, name: name.trim(), base_url: baseUrl.trim(), api_key: apiKey.trim(), extra_config: extraConfig });
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="glass-panel mb-4 space-y-2 rounded-lg p-4">
      <div className="flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as IntegrationType)}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
        >
          <option value="ai_provider">AI Provider</option>
          <option value="hosting">Hosting</option>
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Name (e.g. "OpenRouter" or "Netlify")'
          className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              type="button"
              key={p.label}
              title={p.hint}
              onClick={() => {
                setBaseUrl(p.url);
                if (!name) setName(p.label);
              }}
              className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-neutral-400 hover:bg-white/10"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {type === "ai_provider" && (
        <p className="text-[11px] leading-relaxed text-neutral-600">
          Tip: <span className="text-neutral-400">OpenRouter</span> is a single key giving
          access to many providers&apos; models — its model list in the Model Router is
          fetched live and is much longer than single-provider entries like Grok (xAI)
          or Gemini. All entries speak the OpenAI-compatible chat completions API, so
          Test Connection works the same way for each.
        </p>
      )}

      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder={
          type === "hosting"
            ? "Deploy hook URL (e.g. https://api.netlify.com/build_hooks/xxxx)"
            : "Base URL (e.g. https://openrouter.ai/api/v1)"
        }
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={type === "hosting" ? "API key (optional for most deploy hooks)" : "API key"}
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />
      <textarea
        value={extraConfig}
        onChange={(e) => setExtraConfig(e.target.value)}
        placeholder='Extra config JSON (optional), e.g. {"org_id": "..."}'
        rows={2}
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100 outline-none focus:border-neutral-500"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded bg-[var(--role-strategist)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Integration"}
      </button>
    </form>
  );
}
