import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Addendum 13 section 4: the public "World Board" cache read.
// GET /api/explore?q=...&tag=... — NO login required; reads the
// public_prompts cache (world-readable by RLS). The GitHub vault remains
// the source of truth; this is the fast searchable mirror.
//
// POST /api/explore { promptId, reason } — anonymous-friendly report/flag,
// written to prompt_reports for manual moderation review.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const tag = searchParams.get("tag")?.trim();

  const supabase = await createClient();
  let query = supabase
    .from("public_prompts")
    .select("prompt_id, author_display_name, author_avatar_url, title, body, tags, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (q) {
    query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
  }
  if (tag) {
    query = query.contains("tags", [tag]);
  }

  const { data: prompts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tags = new Set<string>();
  for (const p of prompts ?? []) for (const t of p.tags ?? []) tags.add(t);

  return NextResponse.json({
    prompts: (prompts ?? []).map((p) => ({
      ...p,
      preview: p.body.length > 220 ? `${p.body.slice(0, 220)}…` : p.body,
    })),
    allTags: Array.from(tags).sort(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const promptId = typeof body?.promptId === "string" ? body.promptId : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!promptId || !reason) {
    return NextResponse.json({ error: "promptId and reason are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // optional — anonymous reports allowed

  // Verify the prompt is actually public before accepting a report.
  const { data: pub } = await supabase
    .from("public_prompts")
    .select("prompt_id")
    .eq("prompt_id", promptId)
    .maybeSingle();
  if (!pub) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  const { error } = await supabase.from("prompt_reports").insert({
    prompt_id: promptId,
    reported_by: user?.id ?? null,
    reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
