import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getIntegrationApiKey } from "@/lib/secrets";

// Dynamic model list for a project's OpenAI-compatible integrations.
// GET /api/projects/[id]/integrations/models?integration=<name>
//
// OpenRouter (and most OpenAI-compatible gateways) expose GET /models; the
// response's data[] carries ids like "anthropic/claude-sonnet-4.5". We pass
// those through so the Model Router dropdown offers every model the gateway
// supports without code changes. Results are cached in-memory for 10 minutes
// per integration name — enough to keep the dropdown snappy without pinning
// stale catalogs (gateways add models frequently).

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { models: { id: string; label: string }[]; fetchedAt: number }>();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const integrationName = new URL(req.url).searchParams.get("integration");
  if (!integrationName) {
    return NextResponse.json({ error: "integration query param is required" }, { status: 400 });
  }

  const { data: integration } = await supabase
    .from("integrations")
    .select("name, base_url, api_key_encrypted")
    .eq("project_id", id)
    .eq("type", "ai_provider")
    .eq("name", integrationName)
    .maybeSingle();

  if (!integration?.base_url) {
    return NextResponse.json({ error: "Integration not found or has no base URL" }, { status: 404 });
  }

  const cached = cache.get(`${id}:${integrationName}`);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ models: cached.models, cached: true });
  }

  const apiKey = await getIntegrationApiKey(
    supabase,
    id,
    integration.name,
    integration.api_key_encrypted
  );

  try {
    const res = await fetch(`${integration.base_url.replace(/\/$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Model list request failed (HTTP ${res.status})` },
        { status: 502 }
      );
    }
    const data = await res.json();
    const models: { id: string; label: string }[] = (data.data ?? [])
      .filter((m: { id?: string }) => typeof m.id === "string")
      .map((m: { id: string; name?: string }) => ({
        id: m.id,
        // OpenRouter entries carry a human name ("Anthropic: Claude Sonnet 4.5");
        // fall back to the raw id for gateways that don't.
        label: m.name ?? m.id,
      }))
      .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));

    cache.set(`${id}:${integrationName}`, { models, fetchedAt: Date.now() });
    return NextResponse.json({ models, cached: false });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not fetch model list: ${err instanceof Error ? err.message : "request failed"}`,
      },
      { status: 502 }
    );
  }
}
