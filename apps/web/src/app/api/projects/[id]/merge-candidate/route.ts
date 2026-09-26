import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSnapshotDiff } from "@/lib/pipeline/isolation";

// Addendum 17: review-before-merge. Returns the most recent unapplied
// snapshot for a project (status "ready"), with the per-file diff summary
// the UI (and `nexus chat`) shows before the user approves the merge.
// A project can legitimately have several pending snapshots (parallel runs);
// this surfaces the latest, and /api/projects/[id]/merge lists all of them.

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

  const { data: snapshot } = await supabase
    .from("run_snapshots")
    .select("run_id")
    .eq("project_id", id)
    .in("status", ["pending", "ready"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot) {
    return NextResponse.json({ candidate: null });
  }

  const diff = await getSnapshotDiff(supabase, id, snapshot.run_id);
  if (!diff) return NextResponse.json({ candidate: null });

  return NextResponse.json({
    candidate: {
      runId: diff.runId,
      status: diff.status,
      files: diff.files,
      totalAdded: diff.totalAdded,
      totalRemoved: diff.totalRemoved,
    },
  });
}
