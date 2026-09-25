"use client";

// Addendum 13 section 4: the Explore feed client. "Use this prompt" drops it
// into the visitor's Office Chat (localStorage handoff → ChatPanel picks it
// up) when signed in, or routes to login first. Report/flag is one click to
// a reason prompt, stored in prompt_reports for manual review.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface PublicPrompt {
  prompt_id: string;
  author_display_name: string;
  author_avatar_url: string | null;
  title: string;
  body: string;
  preview: string;
  tags: string[];
  updated_at: string;
}

export default function ExploreBoard({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PublicPrompt[] | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [usedId, setUsedId] = useState<string | null>(null);
  const [reportedId, setReportedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/explore");
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setPrompts(data.prompts ?? []);
        setAllTags(data.allTags ?? []);
      } else {
        setPrompts([]);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!prompts) return [];
    const q = search.trim().toLowerCase();
    return prompts.filter((p) => {
      const matchesQuery = !q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q);
      const matchesTag = !activeTag || p.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [prompts, search, activeTag]);

  // Named as a plain handler (not "use*" so the hooks lint rule doesn't
  // mistake it for a hook when called from event callbacks).
  function handleUsePrompt(p: PublicPrompt) {
    if (!signedIn) {
      sessionStorage.setItem("nexus-use-prompt", JSON.stringify({ title: p.title, body: p.body }));
      router.push("/login");
      return;
    }
    // Signed in: stage it for Office Chat via localStorage, then navigate.
    localStorage.setItem(
      "nexus-pending-prompt",
      JSON.stringify({ title: p.title, body: p.body })
    );
    setUsedId(p.prompt_id);
    setTimeout(() => {
      router.push("/projects");
    }, 600);
  }

  async function reportPrompt(p: PublicPrompt) {
    const reason = window.prompt(
      `Report "${p.title}" — why are you flagging this prompt?`
    );
    if (!reason?.trim()) return;
    const res = await fetch("/api/explore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptId: p.prompt_id, reason: reason.trim() }),
    });
    if (res.ok) {
      setReportedId(p.prompt_id);
      setTimeout(() => setReportedId(null), 2500);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search public prompts…"
          className="min-w-[220px] flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  activeTag === tag
                    ? "bg-violet-600 text-white"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {prompts === null && <p className="text-sm text-neutral-500">Loading…</p>}
      {prompts !== null && filtered.length === 0 && (
        <p className="text-sm text-neutral-500">
          No public prompts yet. Share one from your Prompt Vault to see it here.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((p) => (
          <article key={p.prompt_id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <div className="mb-2 flex items-center gap-2">
              {p.author_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.author_avatar_url}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-[11px] font-bold text-neutral-300">
                  {(p.author_display_name || "A").slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-neutral-300">
                  {p.author_display_name || "Anonymous builder"}
                </div>
                <div className="text-[10px] text-neutral-600">
                  {new Date(p.updated_at).toLocaleDateString()}
                </div>
              </div>
            </div>

            <h3 className="font-medium">{p.title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-400">
              {p.preview}
            </p>

            {p.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => handleUsePrompt(p)}
                className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
              >
                {usedId === p.prompt_id ? "Opening Office Chat…" : signedIn ? "Use this prompt" : "Sign in to use"}
              </button>
              <button
                onClick={() => reportPrompt(p)}
                className="text-[11px] text-neutral-600 hover:text-neutral-400"
                title="Flag this prompt for review"
              >
                {reportedId === p.prompt_id ? "Reported ✓" : "Report"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {!signedIn && (
        <p className="mt-8 text-center text-xs text-neutral-600">
          <Link href="/login" className="underline hover:text-neutral-400">
            Sign in
          </Link>{" "}
          to use these prompts with your own 5-role AI team.
        </p>
      )}
    </div>
  );
}
