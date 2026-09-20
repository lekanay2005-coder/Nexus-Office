import type { SupabaseClient } from "@supabase/supabase-js";
import { pushFilesToGitHub } from "./github";
import { getLatestDeployment, mapVercelStateToDeployStatus } from "./vercel";
import { getDecryptedApiKey } from "@/lib/apiKeys";
import { getIntegrationApiKey } from "@/lib/secrets";

// Local/dev escape hatch mirroring NEXUS_MOCK_LLM: set NEXUS_MOCK_DEPLOY=1
// to exercise the full Deploy Desk flow (push -> deploy row -> status
// transitions) without a real GitHub repo or Vercel project.
const MOCK_DEPLOY = process.env.NEXUS_MOCK_DEPLOY === "1";

export interface StartDeployArgs {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  // Optional hosting integration to trigger via its deploy-hook URL, in
  // addition to the GitHub push. Not required — Vercel via GitHub's own
  // integration remains the default path.
  hostingIntegrationId?: string;
}

export async function startDeploy({
  supabase,
  projectId,
  userId,
  hostingIntegrationId,
}: StartDeployArgs) {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("github_repo, vercel_project_id")
    .eq("id", projectId)
    .single();

  if (projectError || !project) throw new Error("Project not found");
  if (!project.github_repo) {
    throw new Error("Connect a GitHub repo in Deploy Desk settings first (owner/repo).");
  }

  const { data: files, error: filesError } = await supabase
    .from("files")
    .select("path, content")
    .eq("project_id", projectId);

  if (filesError) throw new Error(`Failed to load files: ${filesError.message}`);

  if (MOCK_DEPLOY) {
    const commitSha = `mock${Date.now().toString(16)}`;
    const { data: deploy, error } = await supabase
      .from("deploys")
      .insert({
        project_id: projectId,
        status: "building",
        github_commit_sha: commitSha,
        branch: "main",
        hosting_integration_id: hostingIntegrationId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await supabase
      .from("projects")
      .update({ last_synced_to_github_at: new Date().toISOString() })
      .eq("id", projectId);
    return deploy;
  }

  const githubToken = await getDecryptedApiKey(supabase, userId, "github");
  if (!githubToken) {
    throw new Error("Add a GitHub token in Settings → Connections before deploying.");
  }

  const { commitSha, branch } = await pushFilesToGitHub(
    githubToken,
    project.github_repo,
    (files ?? []).map((f) => ({ path: f.path, content: f.content })),
    "Deploy from Nexus Office"
  );

  const { data: deploy, error } = await supabase
    .from("deploys")
    .insert({
      project_id: projectId,
      status: "building",
      github_commit_sha: commitSha,
      branch,
      hosting_integration_id: hostingIntegrationId ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Update the project's sync timestamp now that the push itself succeeded,
  // independent of whether a hosting trigger or Vercel status check below
  // succeeds too.
  await supabase
    .from("projects")
    .update({ last_synced_to_github_at: new Date().toISOString() })
    .eq("id", projectId);

  if (hostingIntegrationId) {
    // Generic deploy-hook trigger: most non-Vercel hosts (Netlify, Render,
    // etc.) expose a plain webhook URL that kicks off a build. There's no
    // generic status API across hosts, so this is fire-and-forget — the
    // deploy row is marked "ready" once the trigger itself succeeds
    // (meaning "successfully triggered", not "confirmed live").
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", hostingIntegrationId)
      .eq("project_id", projectId)
      .single();

    if (integration?.base_url) {
      const headers: Record<string, string> = {};
      if (integration.api_key_encrypted || integration.name) {
        const key = await getIntegrationApiKey(
          supabase,
          projectId,
          integration.name,
          integration.api_key_encrypted
        );
        if (key) headers.Authorization = `Bearer ${key}`;
      }
      try {
        const res = await fetch(integration.base_url, { method: "POST", headers });
        await supabase
          .from("deploys")
          .update({
            status: res.ok ? "ready" : "error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", deploy.id);
      } catch (err) {
        await supabase
          .from("deploys")
          .update({
            status: "error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", deploy.id);
        throw new Error(
          `GitHub push succeeded, but triggering ${integration.name} failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const { data: updated } = await supabase
      .from("deploys")
      .select("*")
      .eq("id", deploy.id)
      .single();
    return updated ?? deploy;
  }

  // Best-effort immediate check — Vercel's GitHub integration may already
  // have picked up the push by the time we ask. If not, the client polls
  // the refresh endpoint until it does.
  try {
    await refreshDeployStatus({ supabase, projectId, userId, deployId: deploy.id });
  } catch {
    // Non-fatal: the deploy row stays "building" until the next refresh.
  }

  const { data: updated } = await supabase
    .from("deploys")
    .select("*")
    .eq("id", deploy.id)
    .single();

  return updated ?? deploy;
}

export interface RefreshDeployArgs {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  deployId: string;
}

export async function refreshDeployStatus({
  supabase,
  projectId,
  userId,
  deployId,
}: RefreshDeployArgs) {
  const { data: deploy, error: deployError } = await supabase
    .from("deploys")
    .select("*")
    .eq("id", deployId)
    .eq("project_id", projectId)
    .single();

  if (deployError || !deploy) throw new Error("Deploy not found");

  if (deploy.hosting_integration_id) {
    // Generic deploy-hook triggers have no status API to poll — the row's
    // status was already set to its final value ("ready" or "error") when
    // the trigger request itself completed.
    return deploy;
  }

  if (MOCK_DEPLOY) {
    const { data: updated, error } = await supabase
      .from("deploys")
      .update({
        status: "ready",
        vercel_deployment_id: "mock-deployment",
        deployment_url: "https://example-preview.vercel.app",
        updated_at: new Date().toISOString(),
      })
      .eq("id", deployId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated;
  }

  const { data: project } = await supabase
    .from("projects")
    .select("vercel_project_id")
    .eq("id", projectId)
    .single();

  if (!project?.vercel_project_id) {
    throw new Error("Set a Vercel project ID in Deploy Desk settings to track status.");
  }

  const vercelToken = await getDecryptedApiKey(supabase, userId, "vercel");
  if (!vercelToken) {
    throw new Error("Add a Vercel token in Settings → Connections to track deploy status.");
  }

  const latest = await getLatestDeployment(vercelToken, project.vercel_project_id);
  if (!latest) return deploy;

  const status = mapVercelStateToDeployStatus(latest.readyState);
  const { data: updated, error } = await supabase
    .from("deploys")
    .update({
      status,
      vercel_deployment_id: latest.id,
      deployment_url: latest.url ? `https://${latest.url}` : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deployId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return updated;
}
