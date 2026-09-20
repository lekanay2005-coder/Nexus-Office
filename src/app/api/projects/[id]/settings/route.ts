import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequireApproval, setRequireApproval } from "@/lib/capabilities";
import { logAudit } from "@/lib/audit";

// Per-project production settings. Currently: require_approval
// ("Require approval for production actions", on by default).
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

  const requireApproval = await getRequireApproval(supabase, id);
  return NextResponse.json({ settings: { requireApproval } });
}

// Body: { requireApproval: boolean }
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
  if (typeof body?.requireApproval !== "boolean") {
    return NextResponse.json({ error: "requireApproval (boolean) is required" }, { status: 400 });
  }

  try {
    await setRequireApproval(supabase, id, body.requireApproval);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save setting";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "settings.update",
    target: "require_approval",
    metadata: { value: body.requireApproval },
  });

  return NextResponse.json({ settings: { requireApproval: body.requireApproval } });
}
