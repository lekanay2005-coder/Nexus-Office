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

/** Partial project update (repo connection, branding flags, pro status). */
export async function updateProject(
  client: NexusClient,
  projectId: string,
  patch: {
    github_repo?: string;
    vercel_project_id?: string;
    is_pro?: boolean;
    show_preview_watermark?: boolean;
    watermark_deployed_site?: boolean;
  }
): Promise<ProjectSummary> {
  const data = await client.expect<{ project: ProjectSummary }>(
    "PATCH",
    `/api/projects/${projectId}`,
    patch
  );
  return data.project;
}

/** Creates a project linked to an existing GitHub repo (import flow). */
export async function connectRepo(
  client: NexusClient,
  repoFullName: string
): Promise<ProjectSummary> {
  const data = await client.expect<{ project: ProjectSummary }>(
    "POST",
    "/api/projects/import",
    { repo: repoFullName }
  );
  return data.project;
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
  projectId: string,
  filters?: { actor?: string; action?: string; q?: string; from?: string; to?: string }
): Promise<unknown[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters ?? {})) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const data = await client.expect<{ events?: unknown[] }>(
    "GET",
    `/api/projects/${projectId}/audit${qs ? `?${qs}` : ""}`
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

// --- Role Models (Model Router) & capabilities --------------------------------

export interface RoleModelRow {
  role: string;
  provider: string;
  model: string;
}

export async function getRoleModels(
  client: NexusClient,
  projectId: string
): Promise<RoleModelRow[]> {
  const data = await client.expect<{ roleModels: RoleModelRow[] }>(
    "GET",
    `/api/projects/${projectId}/role-models`
  );
  return data.roleModels ?? [];
}

export async function saveRoleModels(
  client: NexusClient,
  projectId: string,
  roleModels: RoleModelRow[]
): Promise<RoleModelRow[]> {
  const data = await client.expect<{ roleModels: RoleModelRow[] }>(
    "PUT",
    `/api/projects/${projectId}/role-models`,
    { roleModels }
  );
  return data.roleModels ?? [];
}

export type CapabilityMapPayload = Record<string, string[]>;

export async function getCapabilities(
  client: NexusClient,
  projectId: string
): Promise<CapabilityMapPayload> {
  const data = await client.expect<{ capabilities: CapabilityMapPayload }>(
    "GET",
    `/api/projects/${projectId}/capabilities`
  );
  return data.capabilities;
}

export async function saveCapabilities(
  client: NexusClient,
  projectId: string,
  capabilities: CapabilityMapPayload
): Promise<CapabilityMapPayload> {
  const data = await client.expect<{ capabilities: CapabilityMapPayload }>(
    "PUT",
    `/api/projects/${projectId}/capabilities`,
    { capabilities }
  );
  return data.capabilities;
}

// --- Integrations (AI gateways + hosting hooks) --------------------------------

export interface IntegrationEntry {
  id: string;
  type: string;
  name: string;
  base_url: string | null;
  created_at?: string;
}

export async function listIntegrations(
  client: NexusClient,
  projectId: string
): Promise<IntegrationEntry[]> {
  const data = await client.expect<{ integrations: IntegrationEntry[] }>(
    "GET",
    `/api/projects/${projectId}/integrations`
  );
  return data.integrations ?? [];
}

export async function addIntegration(
  client: NexusClient,
  projectId: string,
  integration: { type: "ai_provider" | "hosting"; name: string; baseUrl?: string; apiKey?: string }
): Promise<IntegrationEntry> {
  const data = await client.expect<{ integration: IntegrationEntry }>(
    "POST",
    `/api/projects/${projectId}/integrations`,
    integration
  );
  return data.integration;
}

export async function deleteIntegration(
  client: NexusClient,
  projectId: string,
  integrationId: string
): Promise<void> {
  await client.expect("DELETE", `/api/projects/${projectId}/integrations/${integrationId}`);
}

export async function testIntegration(
  client: NexusClient,
  projectId: string,
  integrationId: string
): Promise<unknown> {
  return client.expect(
    "POST",
    `/api/projects/${projectId}/integrations/${integrationId}/test`,
    {}
  );
}

export async function listGatewayModels(
  client: NexusClient,
  projectId: string,
  integrationName: string
): Promise<string[]> {
  const data = await client.expect<{ models?: string[] }>(
    "GET",
    `/api/projects/${projectId}/integrations/models?integration=${encodeURIComponent(integrationName)}`
  );
  return data.models ?? [];
}
