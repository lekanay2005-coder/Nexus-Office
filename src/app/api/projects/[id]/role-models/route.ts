import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/types/db";
import { logAudit } from "@/lib/audit";

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

  const { data: roleModels, error } = await supabase
    .from("role_models")
    .select("*")
    .eq("project_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ roleModels });
}

const BUILT_IN_PROVIDERS = ["anthropic", "openai", "google"];

// Body: { role: Role, provider: ProviderName | integration name, model: string }
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
  const { role, provider, model } = body ?? {};

  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (typeof provider !== "string" || !provider.trim()) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  if (!BUILT_IN_PROVIDERS.includes(provider)) {
    // Anything else must be a real ai_provider integration for this project.
    const { data: integration } = await supabase
      .from("integrations")
      .select("id")
      .eq("project_id", id)
      .eq("type", "ai_provider")
      .eq("name", provider)
      .maybeSingle();
    if (!integration) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
  }
  if (typeof model !== "string" || !model.trim()) {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  const { data: roleModel, error } = await supabase
    .from("role_models")
    .upsert(
      { project_id: id, role, provider, model },
      { onConflict: "project_id,role" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "model_router.update",
    target: role,
    metadata: { provider, model },
  });

  return NextResponse.json({ roleModel });
}
