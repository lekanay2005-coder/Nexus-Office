"use client";

import { useState } from "react";
import type { Decision, OpenIssue, ProjectMemory } from "@/types/db";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/pipeline/roles";
import { createNexusClient } from "@nexus-office/api-client";

const nexus = createNexusClient();

function uid() {
  return typeof window !== "undefined" && window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function MemoryBoard({
  projectId,
  initialMemory,
  displayName,
}: {
  projectId: string;
  initialMemory: ProjectMemory | null;
  displayName: string;
}) {
  const [techStack, setTechStack] = useState<string[]>(initialMemory?.tech_stack ?? []);
  const [decisions, setDecisions] = useState<Decision[]>(initialMemory?.decisions ?? []);
  const [openIssues, setOpenIssues] = useState<OpenIssue[]>(initialMemory?.open_issues ?? []);
  const [summary, setSummary] = useState(initialMemory?.summary ?? "");
  const [newTech, setNewTech] = useState("");
  const [newIssue, setNewIssue] = useState("");
  const [savingSummary, setSavingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    try {
      await nexus.client.request("PATCH", `/api/projects/${projectId}/memory`, body);
    } catch {
      setError("Failed to save memory");
    }
  }

  function addTech() {
    const value = newTech.trim();
    if (!value || techStack.includes(value)) return;
    const next = [...techStack, value];
    setTechStack(next);
    setNewTech("");
    patch({ tech_stack: next });
  }

  function removeTech(value: string) {
    const next = techStack.filter((t) => t !== value);
    setTechStack(next);
    patch({ tech_stack: next });
  }

  function removeDecision(id: string) {
    const next = decisions.filter((d) => d.id !== id);
    setDecisions(next);
    patch({ decisions: next });
  }

  function addIssue() {
    const text = newIssue.trim();
    if (!text) return;
    const next: OpenIssue[] = [
      ...openIssues,
      { id: uid(), text, status: "open", created_at: new Date().toISOString() },
    ];
    setOpenIssues(next);
    setNewIssue("");
    patch({ open_issues: next });
  }

  function toggleIssue(id: string) {
    const next = openIssues.map((i) =>
      i.id === id ? { ...i, status: i.status === "open" ? ("resolved" as const) : ("open" as const) } : i
    );
    setOpenIssues(next);
    patch({ open_issues: next });
  }

  function removeIssue(id: string) {
    const next = openIssues.filter((i) => i.id !== id);
    setOpenIssues(next);
    patch({ open_issues: next });
  }

  async function saveSummary() {
    setSavingSummary(true);
    await patch({ summary });
    setSavingSummary(false);
  }

  const sortedDecisions = [...decisions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const openFirst = [...openIssues].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "open" ? -1 : 1
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-8 text-neutral-100">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Memory Board</h2>
        <p className="text-sm text-neutral-500">
          The project&apos;s persistent memory — auto-appended by Ops after each pipeline
          run, editable by you.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-400">Summary</h3>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder="Free-text rolling summary of the project, fed to every role."
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <div className="mt-1 flex justify-end">
          <button
            onClick={saveSummary}
            disabled={savingSummary}
            className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            {savingSummary ? "Saving…" : "Save summary"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-400">Tech Stack</h3>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {techStack.map((tech) => (
            <span
              key={tech}
              className="flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300"
            >
              {tech}
              <button
                onClick={() => removeTech(tech)}
                className="text-neutral-500 hover:text-red-400"
                aria-label={`Remove ${tech}`}
              >
                ×
              </button>
            </span>
          ))}
          {techStack.length === 0 && (
            <span className="text-xs text-neutral-600">Nothing recorded yet.</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={newTech}
            onChange={(e) => setNewTech(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTech()}
            placeholder="Add a technology…"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            onClick={addTech}
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Add
          </button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-400">Decisions Log</h3>
          {displayName && (
            <span className="text-[11px] text-neutral-500">
              Your picks are logged as{" "}
              <span className="font-medium text-neutral-300">{displayName}</span>
            </span>
          )}
        </div>
        <ul className="space-y-2">
          {sortedDecisions.map((d) => (
            <li
              key={d.id}
              className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: ROLE_COLORS[d.role] }}
                title={ROLE_LABELS[d.role]}
              >
                {ROLE_LABELS[d.role][0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-200">{d.text}</p>
                <p className="text-[11px] text-neutral-600">
                  {new Date(d.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => removeDecision(d.id)}
                className="shrink-0 text-xs text-neutral-600 hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
          {sortedDecisions.length === 0 && (
            <li className="text-sm text-neutral-500">No decisions logged yet.</li>
          )}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-400">Open Issues</h3>
        <ul className="space-y-2">
          {openFirst.map((issue) => (
            <li
              key={issue.id}
              className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <input
                type="checkbox"
                checked={issue.status === "resolved"}
                onChange={() => toggleIssue(issue.id)}
                className="h-4 w-4 shrink-0"
              />
              <p
                className={`min-w-0 flex-1 text-sm ${
                  issue.status === "resolved"
                    ? "text-neutral-600 line-through"
                    : "text-neutral-200"
                }`}
              >
                {issue.text}
              </p>
              <button
                onClick={() => removeIssue(issue.id)}
                className="shrink-0 text-xs text-neutral-600 hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
          {openFirst.length === 0 && (
            <li className="text-sm text-neutral-500">No open issues.</li>
          )}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            value={newIssue}
            onChange={(e) => setNewIssue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addIssue()}
            placeholder="Add an issue…"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            onClick={addIssue}
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
