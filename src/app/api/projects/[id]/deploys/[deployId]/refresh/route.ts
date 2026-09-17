import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshDeployStatus } from "@/lib/deploy/run";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; deployId: string }> }
) {
  const { id, deployId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const deploy = await refreshDeployStatus({
      supabase,
      projectId: id,
      userId: user.id,
      deployId,
    });
    return NextResponse.json({ deploy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
