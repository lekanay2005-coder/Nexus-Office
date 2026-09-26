// @nexus/pipeline-types — shared TypeScript types for every Nexus Office
// surface (web app, CLI, future surfaces). Zero runtime dependencies so it
// can be imported from any package without pulling in the server stack.

// ---------------------------------------------------------------------------
// Roles & pipeline
// ---------------------------------------------------------------------------

export type Role = "strategist" | "builder" | "analyst" | "qa" | "ops";

export const ROLES: Role[] = ["strategist", "builder", "analyst", "qa", "ops"];

export type PipelineMode = "pipeline" | "direct";
export type RunStatus = "running" | "complete" | "error";

export interface PipelineRun {
  id: string;
  project_id: string;
  user_id: string;
  user_message: string;
  mode: PipelineMode;
  status: RunStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface PipelineStep {
  id: string;
  run_id: string;
  role: Role;
  step_order: number;
  provider: string | null;
  model: string | null;
  input: string | null;
  output: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Project memory
// ---------------------------------------------------------------------------

export interface Decision {
  id: string;
  text: string;
  role: Role;
  run_id: string;
  created_at: string;
}

export interface OpenIssue {
  id: string;
  text: string;
  status: "open" | "resolved";
  created_at: string;
}

export interface ProjectMemory {
  project_id: string;
  tech_stack: string[];
  decisions: Decision[];
  open_issues: OpenIssue[];
  summary: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  user_id: string;
  name: string;
  github_repo: string | null;
  // Addendum 9: GitHub login (user or org) this project's repo lives under.
  // null/empty = the user's personal account.
  github_owner: string | null;
  vercel_project_id: string | null;
  default_branch: string | null;
  last_synced_to_github_at: string | null;
  // Addendum 3 approval-gating (migration 0006). Optional because the
  // column may not exist yet in not-yet-migrated databases.
  require_approval?: boolean;
  // Addendum 17: review-before-merge for pipeline runs. Optional for the
  // same reason — the column arrives with migration 0013.
  require_merge_approval?: boolean;
  // Addendum 4 branding/watermark feature flags (migration 0003_watermark).
  is_pro: boolean;
  show_preview_watermark: boolean;
  watermark_deployed_site: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Files & deploys
// ---------------------------------------------------------------------------

export interface ProjectFile {
  id: string;
  project_id: string;
  path: string;
  content: string;
  updated_at: string;
}

export type DeployStatus = "pending" | "building" | "ready" | "error";

export interface Deploy {
  id: string;
  project_id: string;
  status: DeployStatus;
  github_commit_sha: string | null;
  branch: string | null;
  vercel_deployment_id: string | null;
  deployment_url: string | null;
  hosting_integration_id: string | null;
  created_at: string;
  updated_at: string;
}

export type IntegrationType = "ai_provider" | "hosting";

export interface Integration {
  id: string;
  project_id: string;
  type: IntegrationType;
  name: string;
  base_url: string | null;
  extra_config: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Prompt Vault / Explore board
// ---------------------------------------------------------------------------

export type PromptVisibility = "private" | "public";

export interface Prompt {
  id: string;
  user_id: string;
  title: string;
  body: string;
  tags: string[];
  // Addendum 13: public prompts feed the /explore World Board.
  visibility: PromptVisibility;
  created_at: string;
  updated_at: string;
}

// Addendum 9: per-user profile (display name shown instead of email).
// Addendum 10: avatar_url for the profile page.
// Addendum 13: onboarding_completed gates the auto-start product tour.
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Addendum 17: agent isolation (run snapshots, scope enforcement, merging)
// ---------------------------------------------------------------------------

export type SnapshotStatus = "pending" | "applied" | "rejected" | "undone";

/** A single changed file in a run's diff, with before/after content. */
export interface SnapshotFileDiff {
  path: string;
  /** Content before the run (null = file is new). */
  before: string | null;
  /** Content written by the run (null = file was deleted). */
  after: string | null;
  added: number;
  removed: number;
}

/** File-level diff summary shown in the review-before-merge UI. */
export interface SnapshotDiff {
  runId: string;
  snapshotId: string | null;
  status: SnapshotStatus;
  files: SnapshotFileDiff[];
  totalAdded: number;
  totalRemoved: number;
}

/** Error payload when scope enforcement rejects a run's output. */
export interface ScopeViolation {
  paths: string[];
  message: string;
}
