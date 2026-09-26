import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startDeploy } from "@/lib/deploy/run";
import { getRequireApproval, assertCapability, CapabilityError } from "@/lib/capabilities";
import { logAudit } from "@/lib/audit";

// Production deploys are a risky action (Addendum 3): with require_approval
// on, a request without confirmed=true returns 409 APPROVAL_REQUIRED plus a
// summary for the confirmation modal; the client re-sends confirmed=true.
// Deploys run under the Ops role's trigger_deploy capability.
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
    typeof body?.hostingIntegrationId === "string" && body.hostingIntegrationId
      ? body.hostingIntegrationId
      : undefined;
  const confirmed = body?.confirmed === true;

  // Least-privilege: deploys belong to Ops. The user acts through that
  // capability, so an Ops role stripped of trigger_deploy can't deploy.
  try {
    await assertCapability(supabase, id, "ops", "trigger_deploy");
  } catch (err) {
    if (err instanceof CapabilityError) {
      await logAudit(supabase, {
        projectId: id,
        userId: user.id,
        actor: "system",
        action: "capability.denied",
        target: "ops/trigger_deploy",
        metadata: { kind: "deploy" },
      });
      return NextResponse.json(
        { error: "The Ops role no longer holds the trigger-deploy capability for this project." },
        { status: 403 }
      );
    }
    throw err;
  }

  if (!confirmed && (await getRequireApproval(supabase, id))) {
    const [{ data: project }, { data: files }] = await Promise.all([
      supabase.from("projects").select("github_repo, default_branch").eq("id", id).single(),
      supabase.from("files").select("path").eq("project_id", id),
    ]);

    let target = "GitHub push → hosting";
    if (hostingIntegrationId) {
      const { data: integration } = await supabase
        .from("integrations")
        .select("name, type")
        .eq("id", hostingIntegrationId)
        .eq("project_id", id)
        .maybeSingle();
      if (integration) target = `${integration.name} (${integration.type})`;
    }

    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "approval.required",
      target: project?.github_repo ?? null,
      metadata: { kind: "deploy", files: files?.length ?? 0 },
    });

    return NextResponse.json(
      {
        error: "APPROVAL_REQUIRED",
        approval: {
          kind: "deploy",
          title: "Production deploy",
          lines: [
            `Repository: ${project?.github_repo ?? "(not connected)"}`,
            `Branch: ${project?.default_branch ?? "main"}`,
            `Files to push: ${files?.length ?? 0}`,
            `Deploy target: ${target}`,
          ],
        },
      },
      { status: 409 }
    );
  }

  try {
    const deploy = await startDeploy({
      supabase,
      projectId: id,
      userId: user.id,
      hostingIntegrationId,
    });

    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "deploy.start",
      target: deploy?.branch ?? null,
      metadata: {
        deployId: deploy?.id ?? null,
        commitSha: deploy?.github_commit_sha ?? null,
        hostingIntegrationId: hostingIntegrationId ?? null,
      },
    });

    return NextResponse.json({ deploy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "system",
      action: "deploy.error",
      target: null,
      metadata: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
