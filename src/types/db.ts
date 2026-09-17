export type Role = "strategist" | "builder" | "analyst" | "qa" | "ops";

export const ROLES: Role[] = ["strategist", "builder", "analyst", "qa", "ops"];

export type PipelineMode = "pipeline" | "direct";
export type RunStatus = "running" | "complete" | "error";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  github_repo: string | null;
  vercel_project_id: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface ProjectFile {
  id: string;
  project_id: string;
  path: string;
  content: string;
  updated_at: string;
}

export interface Prompt {
  id: string;
  user_id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}
