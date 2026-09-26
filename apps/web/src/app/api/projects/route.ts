import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PROVIDER_CONFIG } from "@/lib/providers";
import { ROLES } from "@/types/db";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data: project, error } = await supabase
    .from("projects")
    .insert({ name, user_id: user.id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed the persistent memory row immediately so the Memory Board has
  // something to show even before the first pipeline run.
  await supabase.from("project_memory").insert({ project_id: project.id });

  // Seed explicit role_models rows using the default provider so the
  // Settings UI shows what will actually run (and this stays correct if
  // DEFAULT_PROVIDER_CONFIG ever changes after other projects already
  // have their own saved rows).
  await supabase.from("role_models").insert(
    ROLES.map((role) => ({
      project_id: project.id,
      role,
      provider: DEFAULT_PROVIDER_CONFIG.provider,
      model: DEFAULT_PROVIDER_CONFIG.model,
    }))
  );

  return NextResponse.json({ project }, { status: 201 });
}
