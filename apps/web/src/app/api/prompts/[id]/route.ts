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
  listVaultPrompts,
} from "@/lib/prompts/vault";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof payload.title === "string") patch.title = payload.title.trim();
  if (typeof payload.body === "string") patch.body = payload.body.trim();
  if (Array.isArray(payload.tags)) {
    patch.tags = payload.tags.filter(
      (t: unknown): t is string => typeof t === "string" && t.trim() !== ""
    );
  }
  if (payload.visibility === "public" || payload.visibility === "private") {
    patch.visibility = payload.visibility;
  }
  patch.updated_at = new Date().toISOString();

  const { data: prompt, error } = await supabase
    .from("prompts")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  // Visibility changes must reach both the vault JSON and the Explore cache
  // (Addendum 13 section 4) — same sync path as create, "Update prompt:" message.
  let vaultError: string | null = null;
  try {
    const token = await getDecryptedApiKey(supabase, user.id, "github");
    if (token) {
      const profile = await getOrCreateProfile(supabase, user.id).catch(() => null);
      const displayName = profile?.display_name ?? "";
      const meRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        const repo = await ensureVaultRepo(token, me.login);
        const vault = toVaultPrompt({ ...prompt, author_display_name: displayName });
        await commitVaultFile({
          token,
          repoFullName: repo,
          file: {
            slug: slugForPrompt(vault.id, vault.title),
            content: serializeVaultPrompt(vault),
          },
          message: `Update prompt: ${vault.title}`,
          author: displayName
            ? {
                name: displayName,
                email: `${me.id}+${me.login}@users.noreply.github.com`,
              }
            : undefined,
        });

        if (vault.visibility === "public") {
          await supabase.from("public_prompts").upsert(
            {
              prompt_id: vault.id,
              user_id: user.id,
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
      }
    }
  } catch (err) {
    vaultError = err instanceof Error ? err.message : "Vault sync failed";
  }

  return NextResponse.json({ prompt, vaultError });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: removed } = await supabase
    .from("prompts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  // Best-effort: remove the JSON file from the vault repo and the cache row.
  try {
    if (removed) {
      const token = await getDecryptedApiKey(supabase, user.id, "github");
      if (token) {
        const meRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          const repo = await ensureVaultRepo(token, me.login);
          const { slugForPrompt } = await import("@/lib/prompts/vault");
          await commitVaultFile({
            token,
            repoFullName: repo,
            file: { slug: slugForPrompt(removed.id, removed.title), content: null },
            message: `Delete prompt: ${removed.title}`,
          });
        }
      }
    }
  } catch {
    // Vault cleanup is best-effort; the row is already gone from Supabase.
  }
  await supabase.from("public_prompts").delete().eq("prompt_id", id);

  return NextResponse.json({ ok: true });
}

// GET single prompt's full vault state (used by the migration/status UI).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: prompt } = await supabase
    .from("prompts")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  let vault: { repo: string; files: number } | null = null;
  try {
    const token = await getDecryptedApiKey(supabase, user.id, "github");
    if (token) {
      const meRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        const repo = await ensureVaultRepo(token, me.login);
        const files = await listVaultPrompts(token, repo);
        vault = { repo, files: files.length };
      }
    }
  } catch {
    vault = null;
  }

  return NextResponse.json({ prompt, vault });
}
