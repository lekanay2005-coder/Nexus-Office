import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequireApproval, setRequireApproval } from "@/lib/capabilities";
import { logAudit } from "@/lib/audit";

// Per-project production settings:
// - require_approval: "Require approval for production actions"
//   (deploys / GitHub commits), on by default.
// - require_merge_approval (Addendum 17): hold every pipeline run's
//   snapshot at "ready" until the user reviews the diff and approves the
//   merge. Off by default (auto-merge, the existing no-manual-step
//   behavior) — this is the code-merge counterpart of the deploy gate.
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

  // Addendum 17: code-merge approval toggle (default false = auto-merge).
  const { data: projectRow } = await supabase
    .from("projects")
    .select("require_merge_approval")
    .eq("id", id)
    .maybeSingle();
  const requireMergeApproval = projectRow?.require_merge_approval === true;

  return NextResponse.json({ settings: { requireApproval, requireMergeApproval } });
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
  const hasRequireApproval = typeof body?.requireApproval === "boolean";
  const hasRequireMergeApproval = typeof body?.requireMergeApproval === "boolean";
  if (!hasRequireApproval && !hasRequireMergeApproval) {
    return NextResponse.json(
      { error: "requireApproval or requireMergeApproval (boolean) is required" },
      { status: 400 }
    );
  }

  if (hasRequireApproval) {
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
  }

  let requireMergeApproval: boolean | undefined;
  if (hasRequireMergeApproval) {
    requireMergeApproval = body.requireMergeApproval;
    const { error } = await supabase
      .from("projects")
      .update({ require_merge_approval: requireMergeApproval })
      .eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "Could not save merge setting (is migration 0013 applied?)" },
        { status: 500 }
      );
    }
    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "settings.update",
      target: "require_merge_approval",
      metadata: { value: requireMergeApproval },
    });
  }

  return NextResponse.json({
    settings: {
      ...(hasRequireApproval ? { requireApproval: body.requireApproval } : {}),
      ...(requireMergeApproval !== undefined ? { requireMergeApproval } : {}),
    },
  });
}
