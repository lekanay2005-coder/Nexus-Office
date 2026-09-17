import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";

const PROVIDERS = ["anthropic", "openai", "google", "github", "vercel"] as const;

// Returns which providers have a key saved — never the key itself.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("api_keys")
    .select("provider, created_at")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ apiKeys: data });
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

  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
