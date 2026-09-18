import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { planGitHubSync, applyGitHubSync } from "@/lib/deploy/githubSync";

// Body: { resolutions?: Record<path, "mine" | "theirs"> }
//
// Called twice from the client in the conflict case: once with no body to
// get the plan (and the conflict list, if any), then again with
// resolutions once the user has picked a side for each conflicting file.
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
  const resolutions: Record<string, "mine" | "theirs"> = body?.resolutions ?? {};

  try {
    const plan = await planGitHubSync(supabase, id, user.id);

    const allResolved = plan.conflicts.every((c) => resolutions[c.path]);
    if (plan.status === "conflicts" && !allResolved) {
      return NextResponse.json({ status: "conflicts", conflicts: plan.conflicts });
    }

    const result = await applyGitHubSync({ supabase, projectId: id, userId: user.id, resolutions });
    return NextResponse.json({ status: "pushed", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    if (message === "RECONNECT_GITHUB") {
      return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
