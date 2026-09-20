import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { setUserProviderKey, deleteUserProviderKey } from "@/lib/secrets";

const PROVIDERS = ["anthropic", "openai", "google", "github", "vercel"] as const;

// Returns which providers have a key saved — never the key itself. The
// union of the legacy api_keys rows and the secrets vault entries, so a
// key stored by either layer (e.g. a vault-only GitHub token captured at
// OAuth sign-in) still shows as configured.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: legacy, error: legacyError }, { data: vaultRows, error: vaultError }] =
    await Promise.all([
      supabase.from("api_keys").select("provider, created_at").eq("user_id", user.id),
      supabase
        .from("secrets")
        .select("key_name, created_at")
        .match({ owner_type: "user", owner_id: user.id }),
    ]);

  if (legacyError || vaultError) {
    return NextResponse.json(
      { error: legacyError?.message ?? vaultError?.message ?? "Failed to list keys" },
      { status: 500 }
    );
  }

  return NextResponse.json({ apiKeys: mergeProviders(legacy ?? [], vaultRows ?? []) });
}

function mergeProviders(
  legacy: { provider: string; created_at: string }[],
  vaultRows: { key_name: string; created_at: string }[]
) {
  const byProvider = new Map<string, string>();
  for (const row of legacy) byProvider.set(row.provider, row.created_at);
  for (const row of vaultRows) {
    // Vault key names follow the `key:{provider}` convention (lib/secrets).
    const match = /^key:(.+)$/.exec(row.key_name);
    if (!match) continue;
    const existing = byProvider.get(match[1]);
    if (!existing || new Date(row.created_at) > new Date(existing)) {
      byProvider.set(match[1], row.created_at);
    }
  }
  return Array.from(byProvider.entries())
    .map(([provider, created_at]) => ({ provider, created_at }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// Body: { provider: "anthropic" | "openai" | "google", key: string }
export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const provider = body?.provider;
  const key = typeof body?.key === "string" ? body.key.trim() : "";

  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

  let encrypted: string;
  try {
    encrypted = encryptSecret(key);
  } catch {
    return NextResponse.json(
      { error: "Server is missing NEXUS_ENCRYPTION_KEY; cannot store API keys." },
      { status: 500 }
    );
  }

  // The vault is the source of truth; the legacy api_keys row is mirrored
  // so pre-vault readers keep working during the transition.
  try {
    await setUserProviderKey(supabase, user.id, provider, key);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to store key" },
      { status: 500 }
    );
  }

  const { error } = await supabase
    .from("api_keys")
    .upsert(
      { user_id: user.id, provider, encrypted_key: encrypted },
      { onConflict: "user_id,provider" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Body: { provider: "anthropic" | "openai" | "google" }
export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const provider = body?.provider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  try {
    await deleteUserProviderKey(supabase, user.id, provider);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete key" },
      { status: 500 }
    );
  }

  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
