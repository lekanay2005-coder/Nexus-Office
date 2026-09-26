import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { setIntegrationApiKey } from "@/lib/secrets";
import { logAudit } from "@/lib/audit";

const SELECT_COLUMNS = "id, project_id, type, name, base_url, extra_config, created_at";

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

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select(SELECT_COLUMNS)
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ integrations });
}

// Body: { type: "ai_provider" | "hosting", name, base_url?, api_key, extra_config? }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const type = body?.type;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const baseUrl = typeof body?.base_url === "string" ? body.base_url.trim() : null;
  const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";
  const extraConfig =
    body?.extra_config && typeof body.extra_config === "object" ? body.extra_config : {};

  if (type !== "ai_provider" && type !== "hosting") {
    return NextResponse.json({ error: "type must be ai_provider or hosting" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  // AI providers always need a key to call their API. Hosting deploy hooks
  // often don't — the hook URL itself is the secret.
  if (type === "ai_provider" && !apiKey) {
    return NextResponse.json({ error: "api_key is required" }, { status: 400 });
  }

  // The key lives in the shared secrets vault (AES-256-GCM at rest). The
  // legacy api_key_encrypted column is still mirrored so any reader that
  // hasn't moved to the vault keeps working during the transition.
  let encrypted: string | null = null;
  if (apiKey) {
    try {
      encrypted = encryptSecret(apiKey);
    } catch {
      return NextResponse.json(
        { error: "Server is missing NEXUS_ENCRYPTION_KEY; cannot store integration keys." },
        { status: 500 }
      );
    }
  }

  const { data: integration, error } = await supabase
    .from("integrations")
    .upsert(
      {
        project_id: id,
        type,
        name,
        base_url: baseUrl || null,
        api_key_encrypted: encrypted,
        extra_config: extraConfig,
      },
      { onConflict: "project_id,name" }
    )
    .select(SELECT_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (apiKey) {
    try {
      await setIntegrationApiKey(supabase, id, name, apiKey);
    } catch {
      // Non-fatal: the mirrored legacy column still holds the key.
    }
  }

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "integration.save",
    target: name,
    metadata: { type, hasKey: Boolean(apiKey), baseUrl },
  });

  return NextResponse.json({ integration }, { status: 201 });
}
