import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKey } from "@/lib/apiKeys";
import { getOrCreateProfile } from "@/lib/profile";
import {
  ensureVaultRepo,
  toVaultPrompt,
  serializeVaultPrompt,
  slugForPrompt,
  commitVaultFile,
  migrateLegacyMarkdownPrompts,
} from "@/lib/prompts/vault";

// GET /api/prompts?q=search+text&tag=some-tag
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const tag = searchParams.get("tag")?.trim();

  let query = supabase
    .from("prompts")
    .select("*")
    .order("updated_at", { ascending: false });

  if (q) {
    query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
  }
  if (tag) {
    query = query.contains("tags", [tag]);
  }

  const { data: prompts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompts });
}

// Shared post-save work: mirror into the GitHub vault as JSON and refresh
// the public_prompts cache row. Best-effort — a vault/GitHub failure never
// loses the Supabase row (the cache is repaired on the next save).
async function syncPromptToVault(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  row: {
    id: string;
    title: string;
    body: string;
    tags: string[] | null;
    visibility: string | null;
    created_at: string;
    updated_at: string;
  };
  commitMessage: string;
}): Promise<{ vaultError: string | null }> {
  const { supabase, userId, row, commitMessage } = args;
  try {
    const token = await getDecryptedApiKey(supabase, userId, "github");
    if (!token) return { vaultError: null }; // no GitHub connection yet — cache-only

    const profile = await getOrCreateProfile(supabase, userId).catch(() => null);
    const displayName = profile?.display_name ?? "";

    const meRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!meRes.ok) return { vaultError: null };
    const me = await meRes.json();

    const repo = await ensureVaultRepo(token, me.login);
    const vault = toVaultPrompt({ ...row, author_display_name: displayName });
    const author = displayName
      ? {
          name: displayName,
          email: `${me.id}+${me.login}@users.noreply.github.com`,
        }
      : undefined;

    await commitVaultFile({
      token,
      repoFullName: repo,
      file: {
        slug: slugForPrompt(vault.id, vault.title),
        content: serializeVaultPrompt(vault),
      },
      message: commitMessage,
      author,
    });

    // Refresh the Explore cache row (only public prompts appear there).
    if (vault.visibility === "public") {
      await supabase.from("public_prompts").upsert(
        {
          prompt_id: vault.id,
          user_id: userId,
          author_display_name: displayName,
          author_avatar_url: profile?.avatar_url ?? null,
          title: vault.title,
          body: vault.body,
          tags: vault.tags,
          updated_at: vault.updated_at,
        },
        { onConflict: "prompt_id" }
      );
    } else {
      await supabase.from("public_prompts").delete().eq("prompt_id", vault.id);
    }

    // First vault write after this update: sweep any legacy .md files into
    // the JSON format so old prompts survive the format change.
    await migrateLegacyMarkdownPrompts({ token, repoFullName: repo, author });

    return { vaultError: null };
  } catch (err) {
    return { vaultError: err instanceof Error ? err.message : "Vault sync failed" };
  }
}

// Body: { title: string, body: string, tags?: string[], visibility?: 'private' | 'public' }
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  const tags = Array.isArray(payload?.tags)
    ? payload.tags.filter((t: unknown): t is string => typeof t === "string" && t.trim() !== "")
    : [];
  const visibility = payload?.visibility === "public" ? "public" : "private";

  if (!title || !body) {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 });
  }

  const { data: prompt, error } = await supabase
    .from("prompts")
    .insert({ user_id: user.id, title, body, tags, visibility })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { vaultError } = await syncPromptToVault({
    supabase,
    userId: user.id,
    row: prompt,
    commitMessage: `Add prompt: ${title}`,
  });

  return NextResponse.json({ prompt, vaultError }, { status: 201 });
}
