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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: memory } = await supabase
    .from("project_memory")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();

  return NextResponse.json({ project, memory });
}

// Body: { github_repo?: string, vercel_project_id?: string }
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

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.github_repo === "string") patch.github_repo = body.github_repo.trim() || null;
  if (typeof body.vercel_project_id === "string") {
    patch.vercel_project_id = body.vercel_project_id.trim() || null;
  }
  patch.updated_at = new Date().toISOString();

  const { data: project, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project });
}
