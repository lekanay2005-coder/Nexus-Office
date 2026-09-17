import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

// Body: { title: string, body: string, tags?: string[] }
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

  if (!title || !body) {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 });
  }

  const { data: prompt, error } = await supabase
    .from("prompts")
    .insert({ user_id: user.id, title, body, tags })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompt }, { status: 201 });
}
