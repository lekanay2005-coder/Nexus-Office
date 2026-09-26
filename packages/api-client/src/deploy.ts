import { NexusClient } from "./config";

// src/deploy.ts — Deploy Desk + GitHub sync calls.

export interface DeployResult {
  deploy: {
    id: string;
    status: string;
    github_commit_sha: string | null;
    deployment_url: string | null;
  };
}

export async function deployProject(
  client: NexusClient,
  projectId: string,
  options: { confirmed?: boolean; hostingIntegrationId?: string } = {}
): Promise<DeployResult> {
  return client.expect("POST", `/api/projects/${projectId}/deploy`, {
    confirmed: options.confirmed ?? true,
    ...(options.hostingIntegrationId ? { hostingIntegrationId: options.hostingIntegrationId } : {}),
  });
}

export async function getDeployStatus(
  client: NexusClient,
  projectId: string,
  deployId: string
): Promise<DeployResult> {
  return client.expect(
    "POST",
    `/api/projects/${projectId}/deploys/${deployId}/refresh`,
    {}
  );
}

export interface SyncResult {
  status: string;
  commitSha?: string;
  branch?: string;
  url?: string;
  filesPushed?: number;
}

export interface SyncConflict {
  path: string;
  base: string | null;
  ours: string;
  theirs: string | null;
}

/**
 * Pushes the project's files to GitHub. Call without resolutions first: a
 * 409-shaped response with `conflicts` means the repo diverged and the user
 * must pick a side per file; re-send with resolutions filled.
 */
export async function syncToGitHub(
  client: NexusClient,
  projectId: string,
  options: { confirmed?: boolean; resolutions?: Record<string, "mine" | "theirs"> } = {}
): Promise<SyncResult> {
  return client.expect("POST", `/api/projects/${projectId}/github/sync`, {
    confirmed: options.confirmed ?? true,
    resolutions: options.resolutions ?? {},
  });
}

export async function listGitHubOwners(
  client: NexusClient
): Promise<{ owners: { login: string; type: "User" | "Organization" }[]; activeOwner?: string }> {
  return client.expect("GET", "/api/github/owners");
}

export async function listOwnerRepositories(
  client: NexusClient,
  owner: string
): Promise<{ repos: { fullName: string; private: boolean; defaultBranch: string }[]; activeOwner?: string }> {
  return client.expect(
    "GET",
    `/api/github/owners?owner=${encodeURIComponent(owner)}`
  );
}

export async function createGitHubRepo(
  client: NexusClient,
  name: string,
  isPrivate: boolean,
  owner?: string
): Promise<{ repo: { fullName: string } }> {
  return client.expect("POST", "/api/github/owners", { name, private: isPrivate, owner });
}
