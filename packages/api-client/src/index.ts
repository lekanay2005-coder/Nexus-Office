// @nexus-office/api-client — entry point.
//
// `createNexusClient({ baseUrl, token })` returns a client with every
// domain method bound. Browser callers omit baseUrl (same-origin) and
// token (cookie auth); the CLI passes both. No Next.js imports anywhere.

import { NexusClient, type NexusClientConfig } from "./config";

import * as pipeline from "./pipeline";
import * as projects from "./projects";
import * as vault from "./vault";
import * as deploy from "./deploy";
import * as auth from "./auth";
import * as profile from "./profile";
import * as explore from "./explore";

// Named re-exports so consumers can import functions and types directly.
export { runPipeline, listPipelineRuns, getPipelineRun } from "./pipeline";
export type { PipelineDone, PipelineIsolationSummary, PipelineStepEvent, StepHandler } from "./pipeline";
export { listProjects, getProject, updateProject, connectRepo, listFiles, saveFile, getMemory, saveMemory, getSettings, saveSettings, getCost, getAudit, getMergeCandidate, mergeRun, rejectRun, undoLastRun, getRoleModels, saveRoleModels, getCapabilities, saveCapabilities, listIntegrations, addIntegration, deleteIntegration, testIntegration, listGatewayModels } from "./projects";
export type { ProjectSummary, ProjectFileEntry, MergeCandidate, MergeCandidateFile, RoleModelRow, IntegrationEntry } from "./projects";
export { listVaultPrompts, saveVaultPrompt, setPromptVisibility, deleteVaultPrompt } from "./vault";
export type { VaultPromptEntry } from "./vault";
export { deployProject, getDeployStatus, syncToGitHub, listGitHubOwners, listOwnerRepositories, createGitHubRepo } from "./deploy";
export type { DeployResult, SyncResult, SyncConflict } from "./deploy";
export { getSession, listApiKeys, saveApiKey, deleteApiKey } from "./auth";
export type { SessionInfo } from "./auth";
export { getDisplayName, saveDisplayName, getOnboarding, completeOnboarding, getConfig } from "./profile";
export type { DisplayNameResponse } from "./profile";
export { listExplorePrompts, reportExplorePrompt } from "./explore";
export type { ExplorePrompt } from "./explore";

export { NexusClient, ApiError } from "./config";
export type { NexusClientConfig } from "./config";
export * as pipeline from "./pipeline";
export * as projects from "./projects";
export * as vault from "./vault";
export * as deploy from "./deploy";
export * as auth from "./auth";
export * as profile from "./profile";
export * as explore from "./explore";

export interface NexusClientAll extends ReturnType<typeof bindAll> {}

function bindAll(client: NexusClient) {
  return {
    // pipeline
    runPipeline: (projectId: string, message: string, onStep?: pipeline.StepHandler) =>
      pipeline.runPipeline(client, projectId, message, onStep),
    listPipelineRuns: (projectId: string) => pipeline.listPipelineRuns(client, projectId),
    getPipelineRun: (projectId: string, runId: string) =>
      pipeline.getPipelineRun(client, projectId, runId),
    // projects
    listProjects: () => projects.listProjects(client),
    getProject: (projectId: string) => projects.getProject(client, projectId),
    updateProject: (projectId: string, patch: Parameters<typeof projects.updateProject>[2]) =>
      projects.updateProject(client, projectId, patch),
    connectRepo: (repoFullName: string) => projects.connectRepo(client, repoFullName),
    listFiles: (projectId: string) => projects.listFiles(client, projectId),
    saveFile: (projectId: string, path: string, content: string) =>
      projects.saveFile(client, projectId, path, content),
    getMemory: (projectId: string) => projects.getMemory(client, projectId),
    saveMemory: (projectId: string, summary: string) =>
      projects.saveMemory(client, projectId, summary),
    getSettings: (projectId: string) => projects.getSettings(client, projectId),
    saveSettings: (projectId: string, settings: Parameters<typeof projects.saveSettings>[2]) =>
      projects.saveSettings(client, projectId, settings),
    getCost: (projectId: string) => projects.getCost(client, projectId),
    getAudit: (
      projectId: string,
      filters?: Parameters<typeof projects.getAudit>[2]
    ) => projects.getAudit(client, projectId, filters),
    getRoleModels: (projectId: string) => projects.getRoleModels(client, projectId),
    saveRoleModels: (projectId: string, roleModels: projects.RoleModelRow[]) =>
      projects.saveRoleModels(client, projectId, roleModels),
    getCapabilities: (projectId: string) => projects.getCapabilities(client, projectId),
    saveCapabilities: (projectId: string, capabilities: projects.CapabilityMapPayload) =>
      projects.saveCapabilities(client, projectId, capabilities),
    listIntegrations: (projectId: string) => projects.listIntegrations(client, projectId),
    addIntegration: (
      projectId: string,
      integration: Parameters<typeof projects.addIntegration>[2]
    ) => projects.addIntegration(client, projectId, integration),
    deleteIntegration: (projectId: string, integrationId: string) =>
      projects.deleteIntegration(client, projectId, integrationId),
    testIntegration: (projectId: string, integrationId: string) =>
      projects.testIntegration(client, projectId, integrationId),
    listGatewayModels: (projectId: string, integrationName: string) =>
      projects.listGatewayModels(client, projectId, integrationName),
    getMergeCandidate: (projectId: string) => projects.getMergeCandidate(client, projectId),
    mergeRun: (projectId: string, runId: string) => projects.mergeRun(client, projectId, runId),
    rejectRun: (projectId: string, runId: string) => projects.rejectRun(client, projectId, runId),
    undoLastRun: (projectId: string, runId?: string) =>
      projects.undoLastRun(client, projectId, runId),
    // vault
    listVaultPrompts: () => vault.listVaultPrompts(client),
    saveVaultPrompt: (prompt: Parameters<typeof vault.saveVaultPrompt>[1]) =>
      vault.saveVaultPrompt(client, prompt),
    setPromptVisibility: (promptId: string, visibility: "private" | "public") =>
      vault.setPromptVisibility(client, promptId, visibility),
    deleteVaultPrompt: (promptId: string) => vault.deleteVaultPrompt(client, promptId),
    // deploy
    deployProject: (projectId: string, options?: Parameters<typeof deploy.deployProject>[2]) =>
      deploy.deployProject(client, projectId, options),
    getDeployStatus: (projectId: string, deployId: string) =>
      deploy.getDeployStatus(client, projectId, deployId),
    syncToGitHub: (projectId: string, options?: Parameters<typeof deploy.syncToGitHub>[2]) =>
      deploy.syncToGitHub(client, projectId, options),
    listGitHubOwners: () => deploy.listGitHubOwners(client),
    listOwnerRepositories: (owner: string) => deploy.listOwnerRepositories(client, owner),
    createGitHubRepo: (name: string, isPrivate: boolean, owner?: string) =>
      deploy.createGitHubRepo(client, name, isPrivate, owner),
    // auth
    getSession: () => auth.getSession(client),
    listApiKeys: () => auth.listApiKeys(client),
    saveApiKey: (provider: string, key: string) => auth.saveApiKey(client, provider, key),
    deleteApiKey: (provider: string) => auth.deleteApiKey(client, provider),
    // profile & explore
    getDisplayName: () => profile.getDisplayName(client),
    saveDisplayName: (displayName: string) => profile.saveDisplayName(client, displayName),
    getOnboarding: () => profile.getOnboarding(client),
    completeOnboarding: () => profile.completeOnboarding(client),
    getConfig: () => profile.getConfig(client),
    listExplorePrompts: (filters?: Parameters<typeof explore.listExplorePrompts>[1]) =>
      explore.listExplorePrompts(client, filters),
    reportExplorePrompt: (promptId: string, reason: string) =>
      explore.reportExplorePrompt(client, promptId, reason),
  };
}

export function createNexusClient(config: NexusClientConfig = {}) {
  const client = new NexusClient(config);
  return { client, ...bindAll(client) };
}
