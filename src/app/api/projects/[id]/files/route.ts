import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const { data: files, error } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", id)
    .order("path", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ files });
}

// Manual save from the Monaco editor (in addition to Builder-driven writes).
export async function PUT(
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
  const path = typeof body?.path === "string" ? body.path : "";
  const content = typeof body?.content === "string" ? body.content : "";
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });

  const { data: file, error } = await supabase
    .from("files")
    .upsert(
      { project_id: id, path, content, updated_at: new Date().toISOString() },
      { onConflict: "project_id,path" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ file });
}
