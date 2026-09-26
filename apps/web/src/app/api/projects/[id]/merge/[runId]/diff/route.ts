import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSnapshotDiff } from "@/lib/pipeline/isolation";

// Addendum 17: per-run diff for the review UI / CLI. Shows exactly what a
// run changed (files, +/− lines) regardless of whether the snapshot is still
// pending, applied, rejected, or undone.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id, runId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const diff = await getSnapshotDiff(supabase, id, runId);
  if (!diff) return NextResponse.json({ error: "No snapshot for this run" }, { status: 404 });

  return NextResponse.json({ diff });
}
