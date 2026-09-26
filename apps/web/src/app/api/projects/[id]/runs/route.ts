import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Full pipeline transcript for a project: runs with their nested steps,
// most recent first.
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

  const { data: runs, error } = await supabase
    .from("pipeline_runs")
    .select("*, pipeline_steps(*)")
    .eq("project_id", id)
    .order("created_at", { ascending: true })
    .order("step_order", { ascending: true, referencedTable: "pipeline_steps" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs });
}
