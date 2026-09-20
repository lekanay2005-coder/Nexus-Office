// Thin typed-shape API layer over the existing Next.js route handlers.
// Every function maps 1:1 to an endpoint the React app already uses.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

function json(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const projects = (id, rest = "") => `/api/projects/${id}${rest}`;

// ---- Bootstrap ----
export async function getConfig() {
  return handle(await fetch("/api/config"));
}

// ---- Projects ----
export const listProjects = async () => handle(await fetch("/api/projects"));
export const getProject = async (id) => handle(await fetch(projects(id)));
export const patchProject = async (id, body) => handle(await fetch(projects(id), json("PATCH", body)));

// ---- Pipeline (SSE) ----
export async function runPipeline(projectId, message) {
  const res = await fetch("/api/pipeline", json("POST", { projectId, message }));
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? "Pipeline failed", res.status);
  }
  return res.body;
}

// ---- Runs / files / memory / cost ----
export const listRuns = async (id) => handle(await fetch(projects(id, "/runs")));
export const listFiles = async (id) => handle(await fetch(projects(id, "/files")));
export const saveFile = async (id, path, content) =>
  handle(await fetch(projects(id, "/files"), json("PUT", { path, content })));
export const getMemory = async (id) => handle(await fetch(projects(id, "/memory")));
export const patchMemory = async (id, body) => handle(await fetch(projects(id, "/memory"), json("PATCH", body)));
export const getCost = async (id) => handle(await fetch(projects(id, "/cost")));

// ---- Model router ----
export const listRoleModels = async (id) => handle(await fetch(projects(id, "/role-models")));
export const putRoleModel = async (id, body) => handle(await fetch(projects(id, "/role-models"), json("PUT", body)));

// ---- API keys ----
export const listApiKeys = async () => handle(await fetch("/api/settings/api-keys"));
export const putApiKey = async (provider, key) =>
  handle(await fetch("/api/settings/api-keys", json("PUT", { provider, key })));
export const deleteApiKey = async (provider) =>
  handle(await fetch("/api/settings/api-keys", json("DELETE", { provider })));

// ---- Integrations ----
export const listIntegrations = async (id) => handle(await fetch(projects(id, "/integrations")));
export const saveIntegration = async (id, body) => handle(await fetch(projects(id, "/integrations"), json("POST", body)));
export const deleteIntegration = async (id, integrationId) =>
  handle(await fetch(projects(id, `/integrations/${integrationId}`), { method: "DELETE" }));
export const testIntegration = async (id, integrationId) =>
  handle(await fetch(projects(id, `/integrations/${integrationId}/test`), { method: "POST" }));

// ---- GitHub sync / deploy ----
export const listGithubRepos = async (id) => handle(await fetch(projects(id, "/github/repos")));
export const createGithubRepo = async (id, name, isPrivate) =>
  handle(await fetch(projects(id, "/github/repos"), json("POST", { name, private: isPrivate })));
export const syncGithub = async (id, resolutions = {}) =>
  handle(await fetch(projects(id, "/github/sync"), json("POST", { resolutions })));
export const listDeploys = async (id) => handle(await fetch(projects(id, "/deploys")));
export const startDeploy = async (id, hostingIntegrationId) =>
  handle(await fetch(projects(id, "/deploy"), json("POST", { hostingIntegrationId })));
export const refreshDeploy = async (id, deployId) =>
  handle(await fetch(projects(id, `/deploys/${deployId}/refresh`), { method: "POST" }));

// Extracts role-tagged file blocks (```path=foo/bar.ext fenced blocks) the
// same way the server's extractFilesFromBuilderOutput does — lets the Code
// Canvas pick up Builder-written files immediately after a run finishes.
export function extractFilesFromBuilderOutput(output) {
  const re = /```path=([^\n]+)\n([\s\S]*?)```/g;
  const files = [];
  for (const match of output.matchAll(re)) {
    const path = match[1].trim();
    const content = match[2].replace(/\n$/, "");
    if (path) files.push({ path, content });
  }
  return files;
}
