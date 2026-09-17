import type { SupabaseClient } from "@supabase/supabase-js";
import { pushFilesToGitHub } from "./github";
import { getLatestDeployment, mapVercelStateToDeployStatus } from "./vercel";
import { getDecryptedApiKey } from "@/lib/apiKeys";

// Local/dev escape hatch mirroring NEXUS_MOCK_LLM: set NEXUS_MOCK_DEPLOY=1
// to exercise the full Deploy Desk flow (push -> deploy row -> status
// transitions) without a real GitHub repo or Vercel project.
const MOCK_DEPLOY = process.env.NEXUS_MOCK_DEPLOY === "1";

export interface StartDeployArgs {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
}

export async function startDeploy({ supabase, projectId, userId }: StartDeployArgs) {
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
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
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
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

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
