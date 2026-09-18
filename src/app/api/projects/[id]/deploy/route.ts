import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startDeploy } from "@/lib/deploy/run";

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

  const body = await req.json().catch(() => ({}));
  const hostingIntegrationId =
    typeof body?.hostingIntegrationId === "string" ? body.hostingIntegrationId : undefined;

  try {
    const deploy = await startDeploy({
      supabase,
      projectId: id,
      userId: user.id,
      hostingIntegrationId,
    });
    return NextResponse.json({ deploy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
