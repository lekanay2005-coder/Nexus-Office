import { NexusClient } from "./config";

// src/projects.ts — project-scoped endpoints: files, memory, settings,
// capabilities, cost, audit, and the Addendum 17 isolation merge/undo.

export interface ProjectSummary {
  id: string;
  name: string;
  github_repo: string | null;
  updated_at: string;
}

export interface ProjectFileEntry {
  id?: string;
  path: string;
  content: string;
  updated_at?: string;
}

export interface MergeCandidateFile {
  path: string;
  before: string | null;
  after: string | null;
  added: number;
  removed: number;
}

export interface MergeCandidate {
  runId: string;
  status: string;
  files: MergeCandidateFile[];
  totalAdded: number;
  totalRemoved: number;
}

export async function listProjects(client: NexusClient): Promise<ProjectSummary[]> {
  const data = await client.expect<{ projects: ProjectSummary[] }>("GET", "/api/projects");
  return data.projects ?? [];
}

export async function getProject(
  client: NexusClient,
  projectId: string
): Promise<{ project: ProjectSummary; memory: unknown }> {
  return client.expect("GET", `/api/projects/${projectId}`);
}

export async function listFiles(
  client: NexusClient,
  projectId: string
): Promise<ProjectFileEntry[]> {
  const data = await client.expect<{ files: ProjectFileEntry[] }>(
    "GET",
    `/api/projects/${projectId}/files`
  );
  return data.files ?? [];
}

export async function saveFile(
  client: NexusClient,
  projectId: string,
  path: string,
  content: string
): Promise<ProjectFileEntry> {
  const data = await client.expect<{ file: ProjectFileEntry }>(
    "PUT",
    `/api/projects/${projectId}/files`,
    { path, content }
  );
  return data.file;
}

export async function getMemory(
  client: NexusClient,
  projectId: string
): Promise<{ memory: unknown }> {
  return client.expect("GET", `/api/projects/${projectId}/memory`);
}

export async function saveMemory(
  client: NexusClient,
  projectId: string,
  summary: string
): Promise<void> {
  await client.expect("PATCH", `/api/projects/${projectId}/memory`, { summary });
}

export async function getSettings(
  client: NexusClient,
  projectId: string
): Promise<{ requireApproval: boolean; requireMergeApproval?: boolean }> {
  const data = await client.expect<{
    settings: { requireApproval: boolean; requireMergeApproval?: boolean };
  }>("GET", `/api/projects/${projectId}/settings`);
  return data.settings;
}

export async function saveSettings(
  client: NexusClient,
  projectId: string,
  settings: { requireApproval?: boolean; requireMergeApproval?: boolean }
): Promise<void> {
  await client.expect("PATCH", `/api/projects/${projectId}/settings`, settings);
}

export async function getCost(client: NexusClient, projectId: string): Promise<unknown> {
  return client.expect("GET", `/api/projects/${projectId}/cost`);
}

export async function getAudit(
  client: NexusClient,
  projectId: string
): Promise<unknown[]> {
  const data = await client.expect<{ events?: unknown[] }>(
    "GET",
    `/api/projects/${projectId}/audit`
  );
  return data.events ?? [];
}

// --- Addendum 17: isolation merge / undo -------------------------------------

export async function getMergeCandidate(
  client: NexusClient,
  projectId: string
): Promise<MergeCandidate | null> {
  const data = await client.expect<{ candidate: MergeCandidate | null }>(
    "GET",
    `/api/projects/${projectId}/merge-candidate`
  );
  return data.candidate;
}

export async function mergeRun(
  client: NexusClient,
  projectId: string,
  runId: string
): Promise<{ status: string; filesApplied?: number }> {
  return client.expect("POST", `/api/projects/${projectId}/merge`, { runId, confirmed: true });
}

export async function rejectRun(
  client: NexusClient,
  projectId: string,
  runId: string
): Promise<{ status: string }> {
  return client.expect("POST", `/api/projects/${projectId}/merge`, { runId, reject: true });
}

export async function undoLastRun(
  client: NexusClient,
  projectId: string,
  runId?: string
): Promise<{ undone: boolean; message: string }> {
  return client.expect("POST", `/api/projects/${projectId}/undo`, runId ? { runId } : {});
}
