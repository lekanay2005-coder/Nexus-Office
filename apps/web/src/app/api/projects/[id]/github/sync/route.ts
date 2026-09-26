import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { planGitHubSync, applyGitHubSync, buildCommitMessage } from "@/lib/deploy/githubSync";
import { getRequireApproval, assertCapability, CapabilityError } from "@/lib/capabilities";
import { logAudit } from "@/lib/audit";
import { perfTimer } from "@/lib/perf";
import { validateFiles, type ValidationIssue } from "@/lib/validate";

// Addendum 13 section 5: nothing broken gets pushed. Every candidate file
// passes validation BEFORE the commit; failures are audit-logged and (on a
// first failure with qaRetry=true) routed back through the QA role for one
// auto-fix attempt before surfacing to the user.
async function validatedPush(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectId: string;
  userId: string;
  resolutions: Record<string, "mine" | "theirs">;
}): Promise<{ status: "pushed"; commitSha: string; branch: string; url: string; filesPushed: number } | { status: "validation_failed"; issues: ValidationIssue[]; retried: boolean }> {
  const { supabase, projectId, userId, resolutions } = args;

  // Snapshot what would be pushed (same logic applyGitHubSync uses to select
  // files), validate it, then hand off to the real push.
  const { data: allFiles } = await supabase
    .from("files")
    .select("path, content")
    .eq("project_id", projectId);
  const plan = await planGitHubSync(supabase, projectId, userId);
  const contentByPath = new Map((allFiles ?? []).map((f) => [f.path, f.content]));
  const candidates = Array.from(new Set([...plan.cleanPaths, ...plan.conflicts.filter((c) => resolutions[c.path] === "mine").map((c) => c.path)]))
    .map((path) => ({ path, content: contentByPath.get(path) }))
    .filter((f): f is { path: string; content: string } => typeof f.content === "string");

  let result = validateFiles(candidates);
  if (!result.ok) {
    await logAudit(supabase, {
      projectId,
      userId,
      actor: "qa",
      action: "validation.failed",
      target: "github.push",
      metadata: { issues: result.issues.map((i) => ({ path: i.path, message: i.message })) },
    });

    // One retry through the QA role: re-run the pipeline with a fix request.
    // The pipeline itself is unchanged (Addendum 13 DO-NOT) — we just ask it
    // to fix the flagged files before pushing.
    const { runPipeline } = await import("@/lib/pipeline/run");
    try {
      await runPipeline({
        supabase,
        projectId,
        userId,
        userMessage:
          `QA AUTO-FIX REQUEST: the following files failed pre-push validation and must be corrected before commit. ` +
          `Fix ONLY these issues and output the corrected files:\n` +
          result.issues.map((i) => `- ${i.path}: ${i.message}`).join("\n"),
      });
    } catch {
      return { status: "validation_failed", issues: result.issues, retried: false };
    }

    // Re-validate the fixed files.
    const { data: fixedFiles } = await supabase
      .from("files")
      .select("path, content")
      .eq("project_id", projectId);
    result = validateFiles(
      candidates.map((c) => {
        const updated = (fixedFiles ?? []).find((f) => f.path === c.path);
        return { path: c.path, content: updated?.content ?? c.content };
      })
    );
    if (!result.ok) {
      await logAudit(supabase, {
        projectId,
        userId,
        actor: "qa",
        action: "validation.retry_failed",
        target: "github.push",
        metadata: { issues: result.issues.map((i) => ({ path: i.path, message: i.message })) },
      });
      return { status: "validation_failed", issues: result.issues, retried: true };
    }
    await logAudit(supabase, {
      projectId,
      userId,
      actor: "qa",
      action: "validation.autofixed",
      target: "github.push",
      metadata: { fixedPaths: result.issues.length ? [] : candidates.map((c) => c.path) },
    });
  }

  const push = await applyGitHubSync({ supabase, projectId, userId, resolutions });
  return { status: "pushed" as const, ...push };
}

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

    const timer = perfTimer("github.sync");
    const result = await validatedPush({ supabase, projectId: id, userId: user.id, resolutions });
    timer.end();

    if (result.status === "validation_failed") {
      return NextResponse.json(
        {
          status: "validation_failed",
          message:
            `Builder's output had an issue I couldn't auto-fix — here's what's wrong: ` +
            result.issues.map((i) => `${i.path} (${i.message})`).join("; "),
          issues: result.issues,
        },
        { status: 422 }
      );
    }

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

    return NextResponse.json({
      status: "pushed",
      commitSha: result.commitSha,
      branch: result.branch,
      url: result.url,
      filesPushed: result.filesPushed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    if (message === "RECONNECT_GITHUB") {
      return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
