import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applySnapshot, discardSnapshot, getSnapshotDiff } from "@/lib/pipeline/isolation";
import { logAudit } from "@/lib/audit";

// Addendum 17: review-before-merge actions.
//
// POST body: { runId, confirmed?: true }  → approve & merge the snapshot
// POST body: { runId, reject: true }      → discard the snapshot
// GET                                     → list all pending snapshots (each
//                                           with its diff) — parallel-run
//                                           safety: several can be pending
//                                           at once and every one is visible.

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

  const { data: snapshots } = await supabase
    .from("run_snapshots")
    .select("run_id")
    .eq("project_id", id)
    .in("status", ["pending", "ready"])
    .order("created_at", { ascending: false });

  const pending = [];
  for (const s of snapshots ?? []) {
    const diff = await getSnapshotDiff(supabase, id, s.run_id);
    if (diff) pending.push(diff);
  }

  return NextResponse.json({ pending });
}

export async function POST(
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
  const runId = typeof body?.runId === "string" ? body.runId : "";
  const reject = body?.reject === true;

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  // Verify the run belongs to this project.
  const { data: run } = await supabase
    .from("pipeline_runs")
    .select("id")
    .eq("id", runId)
    .eq("project_id", id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (reject) {
    await discardSnapshot(supabase, runId);
    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "merge.rejected",
      target: runId,
      metadata: {},
    });
    return NextResponse.json({ status: "rejected" });
  }

  const result = await applySnapshot(supabase, id, runId);
  if (!result.applied) {
    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "system",
      action: "merge.validation_failed",
      target: runId,
      metadata: { error: result.validationError ?? "unknown" },
    });
    return NextResponse.json(
      { error: result.validationError ?? "Merge failed — check the server logs." },
      { status: 422 }
    );
  }

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "merge.applied",
    target: runId,
    metadata: { filesApplied: result.filesApplied },
  });

  return NextResponse.json({
    status: "applied",
    filesApplied: result.filesApplied,
  });
}
