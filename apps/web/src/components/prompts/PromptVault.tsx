"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import NexusLogo from "@/components/brand/NexusLogo";
import type { Prompt } from "@/types/db";

export default function PromptVault({ initialPrompts }: { initialPrompts: Prompt[] }) {
  const [prompts, setPrompts] = useState<Prompt[]>(initialPrompts);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<Prompt | "new" | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibilityToggling, setVisibilityToggling] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of prompts) for (const t of p.tags) set.add(t);
    return Array.from(set).sort();
  }, [prompts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prompts.filter((p) => {
      const matchesQuery =
        !q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q);
      const matchesTag = !activeTag || p.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [prompts, search, activeTag]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    if (res.ok) setPrompts((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleCopy(prompt: Prompt) {
    await navigator.clipboard.writeText(prompt.body);
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function upsertLocal(prompt: Prompt) {
    setPrompts((prev) => {
      const exists = prev.some((p) => p.id === prompt.id);
      return exists ? prev.map((p) => (p.id === prompt.id ? prompt : p)) : [prompt, ...prev];
    });
  }

  // Addendum 13 section 4: toggling visibility updates the vault JSON in the
  // user's GitHub repo AND the public_prompts Explore cache (server does
  // both); we only reflect the new state locally.
  async function handleToggleVisibility(prompt: Prompt) {
    if (visibilityToggling) return;
    const next = prompt.visibility === "public" ? "private" : "public";
    setVisibilityToggling(prompt.id);
    const res = await fetch(`/api/prompts/${prompt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.prompt) {
      upsertLocal(data.prompt);
    } else if (data?.vaultError) {
      alert(`Saved, but the GitHub vault sync failed: ${data.vaultError}`);
    }
    setVisibilityToggling(null);
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NexusLogo surface="nav" />
            <div>
              <Link
                href="/projects"
                className="data-mono text-xs text-neutral-500 hover:text-[var(--term-accent)]"
              >
                ~/nexus
              </Link>
              <h1 className="mt-1 text-2xl font-semibold">Prompt Vault</h1>
              <p className="data-mono mt-0.5 text-[11px] text-neutral-600">
                git-backed · one .json per prompt
              </p>
            </div>
          </div>
          <button
            onClick={() => setEditing("new")}
            className="btn-terminal data-mono rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            + new prompt
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts…"
            className="min-w-[200px] flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <TagChip label="All" active={!activeTag} onClick={() => setActiveTag(null)} />
              {allTags.map((tag) => (
                <TagChip
                  key={tag}
                  label={tag}
                  active={activeTag === tag}
                  onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                />
              ))}
            </div>
          )}
        </div>

        {editing && (
          <PromptEditor
            prompt={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(p) => {
              upsertLocal(p);
              setEditing(null);
            }}
          />
        )}

        <ul className="mt-6 space-y-3">
          {filtered.map((prompt, i) => (
            <li
              key={prompt.id}
              className="sweep-in rounded-lg border border-neutral-800 bg-neutral-900 p-4"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="font-medium">{prompt.title}</h3>
                  {/* Addendum 13: public/private toggle — public prompts appear
                      on the /explore World Board. */}
                  <button
                    onClick={() => handleToggleVisibility(prompt)}
                    title={
                      prompt.visibility === "public"
                        ? "Public — visible on Explore. Click to make private."
                        : "Private. Click to share on Explore."
                    }
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      prompt.visibility === "public"
                        ? "bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/40"
                        : "bg-neutral-800 text-neutral-500 hover:bg-neutral-700"
                    }`}
                  >
                    {visibilityToggling === prompt.id
                      ? "…"
                      : prompt.visibility === "public"
                        ? "Public"
                        : "Private"}
                  </button>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button
                    onClick={() => handleCopy(prompt)}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    {copiedId === prompt.id ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => setEditing(prompt)}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(prompt.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-neutral-400">{prompt.body}</p>
              {prompt.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {prompt.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="text-sm text-neutral-500">No prompts match.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs ${
        active ? "bg-violet-600 text-white" : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}

function PromptEditor({
  prompt,
  onCancel,
  onSaved,
}: {
  prompt: Prompt | null;
  onCancel: () => void;
  onSaved: (prompt: Prompt) => void;
}) {
  const [title, setTitle] = useState(prompt?.title ?? "");
  const [body, setBody] = useState(prompt?.body ?? "");
  const [tagsInput, setTagsInput] = useState(prompt?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required");
      return;
    }
    setSaving(true);
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const res = await fetch(prompt ? `/api/prompts/${prompt.id}` : "/api/prompts", {
      method: prompt ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, tags }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to save prompt");
      return;
    }
    onSaved(data.prompt);
  }

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Prompt body"
        rows={5}
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />
      <input
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="Tags, comma separated"
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
