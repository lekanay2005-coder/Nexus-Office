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

  const { data: runs, error: runsError } = await supabase
    .from("pipeline_runs")
    .select("id, user_message, mode, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  if (runsError) return NextResponse.json({ error: runsError.message }, { status: 500 });

  const runIds = (runs ?? []).map((r) => r.id);
  if (runIds.length === 0) return NextResponse.json({ runs: [], steps: [] });

  const { data: steps, error: stepsError } = await supabase
    .from("pipeline_steps")
    .select("run_id, role, provider, model, tokens_in, tokens_out, created_at")
    .in("run_id", runIds);

  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 });

  return NextResponse.json({ runs, steps: steps ?? [] });
}
