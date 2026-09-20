import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getIntegrationApiKey } from "@/lib/secrets";
import { logAudit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id, integrationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: integration, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integrationId)
    .eq("project_id", id)
    .single();

  if (error || !integration) {
    return NextResponse.json({ ok: false, message: "Integration not found" }, { status: 404 });
  }

  let apiKey: string | null;
  try {
    apiKey = await getIntegrationApiKey(supabase, id, integration.name, integration.api_key_encrypted);
  } catch {
    apiKey = null;
  }
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "Could not decrypt stored key" });
  }

  if (!integration.base_url) {
    return NextResponse.json({
      ok: false,
      message: "No base URL set — nothing to ping for this integration.",
    });
  }

  // AI-provider integrations get pinged at the OpenAI-compatible /models
  // path (the convention almost every compatible gateway follows); hosting
  // integrations get pinged at their base URL directly.
  const url =
    integration.type === "ai_provider"
      ? `${integration.base_url.replace(/\/$/, "")}/models`
      : integration.base_url;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });

    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "integration.test",
      target: integration.name,
      metadata: { ok: res.ok, status: res.status },
    });

    if (res.ok) {
      return NextResponse.json({ ok: true, message: `Reachable (HTTP ${res.status})` });
    }
    return NextResponse.json({
      ok: false,
      message: `Responded with HTTP ${res.status} — check the key or base URL.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "integration.test",
      target: integration.name,
      metadata: { ok: false, error: message },
    });
    return NextResponse.json({ ok: false, message: `Could not reach ${url}: ${message}` });
  }
}
