import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runPipeline } from "@/lib/pipeline/run";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!projectId || !message) {
    return NextResponse.json({ error: "projectId and message are required" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const result = await runPipeline({
      supabase,
      projectId,
      userId: user.id,
      userMessage: message,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
