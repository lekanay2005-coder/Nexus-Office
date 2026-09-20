import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { planGitHubSync, applyGitHubSync, buildCommitMessage } from "@/lib/deploy/githubSync";
import { getRequireApproval, assertCapability, CapabilityError } from "@/lib/capabilities";
import { logAudit } from "@/lib/audit";

// Body: { resolutions?: Record<path, "mine" | "theirs">, confirmed?: boolean }
//
// Called twice from the client in the conflict case: once with no body to
// get the plan (and the conflict list, if any), then again with
// resolutions once the user has picked a side for each conflicting file.
//
// Approval gating (Addendum 3): a GitHub commit is a risky production
// action. With require_approval on, a push request without
// confirmed=true returns 409 APPROVAL_REQUIRED plus a summary for the
// confirmation modal; the client re-sends with confirmed=true. Approvals
// and rejections are audit-logged.
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
  const confirmed = body?.confirmed === true;

  // Least-privilege: GitHub commits are an Ops capability, so the push only
  // runs while Ops still holds trigger_github_commit for this project.
  try {
    await assertCapability(supabase, id, "ops", "trigger_github_commit");
  } catch (err) {
    if (err instanceof CapabilityError) {
      await logAudit(supabase, {
        projectId: id,
        userId: user.id,
        actor: "system",
        action: "capability.denied",
        target: "ops/trigger_github_commit",
        metadata: { kind: "github.commit" },
      });
      return NextResponse.json(
        { error: "The Ops role no longer holds the GitHub-commit capability for this project." },
        { status: 403 }
      );
    }
    throw err;
  }

  try {
    const plan = await planGitHubSync(supabase, id, user.id);

    const allResolved = plan.conflicts.every((c) => resolutions[c.path]);
    if (plan.status === "conflicts" && !allResolved) {
      return NextResponse.json({ status: "conflicts", conflicts: plan.conflicts });
    }

    if (!confirmed && (await getRequireApproval(supabase, id))) {
      const { data: project } = await supabase
        .from("projects")
        .select("github_repo")
        .eq("id", id)
        .single();
      const commitMessage = await buildCommitMessage(supabase, id);
      const mineCount = plan.conflicts.filter((c) => resolutions[c.path] === "mine").length;

      await logAudit(supabase, {
        projectId: id,
        userId: user.id,
        actor: "user",
        action: "approval.required",
        target: plan.branch,
        metadata: {
          kind: "github.commit",
          repo: project?.github_repo ?? null,
          files: plan.cleanPaths.length + mineCount,
          conflicts: plan.conflicts.length,
        },
      });

      return NextResponse.json(
        {
          error: "APPROVAL_REQUIRED",
          approval: {
            kind: "github.commit",
            title: "Commit to GitHub",
            lines: [
              `Repository: ${project?.github_repo ?? "(unknown)"}`,
              `Branch: ${plan.branch}`,
              `Files to push: ${plan.cleanPaths.length + mineCount}${
                plan.conflicts.length ? ` (${plan.conflicts.length} from conflict resolutions)` : ""
              }`,
              `Commit message: "${commitMessage}"`,
            ],
          },
        },
        { status: 409 }
      );
    }

    const result = await applyGitHubSync({ supabase, projectId: id, userId: user.id, resolutions });

    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "github.commit",
      target: result.branch,
      metadata: {
        commitSha: result.commitSha,
        filesPushed: result.filesPushed,
        url: result.url,
      },
    });

    return NextResponse.json({ status: "pushed", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    if (message === "RECONNECT_GITHUB") {
      return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
