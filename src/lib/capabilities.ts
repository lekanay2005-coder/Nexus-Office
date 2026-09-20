import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type Role } from "@/types/db";

// Capability-based permissions (Addendum 3): least-privilege defaults per
// role, overridable per project via the role_capabilities table.
//
// Enforcement is server-side: before a role's output is applied (Builder
// file writes, Ops memory writes) or a role-scoped production action runs
// (deploy / GitHub commit, which belong to Ops), the capability is checked.
// Projects with no stored rows use the built-in defaults, so existing
// projects keep behaving exactly as before until the user edits them.

export type Capability =
  | "read_files"
  | "write_files"
  | "read_project_memory"
  | "write_project_memory"
  | "trigger_deploy"
  | "trigger_github_commit";

export const ALL_CAPABILITIES: Capability[] = [
  "read_files",
  "write_files",
  "read_project_memory",
  "write_project_memory",
  "trigger_deploy",
  "trigger_github_commit",
];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  read_files: "Read files",
  write_files: "Write files",
  read_project_memory: "Read project memory",
  write_project_memory: "Write project memory",
  trigger_deploy: "Trigger deploy",
  trigger_github_commit: "Trigger GitHub commit",
};

export const DEFAULT_CAPABILITIES: Record<Role, Capability[]> = {
  strategist: ["read_project_memory", "read_files"],
  builder: ["write_files", "read_project_memory"],
  analyst: ["read_files", "read_project_memory"],
  qa: ["read_files", "read_project_memory"],
  ops: ["write_project_memory", "trigger_deploy", "trigger_github_commit"],
};

export class CapabilityError extends Error {
  constructor(
    public role: Role,
    public capability: Capability
  ) {
    super(`Role "${role}" is not allowed to ${capability.replace(/_/g, " ")}`);
    this.name = "CapabilityError";
  }
}

export type CapabilityMap = Record<Role, Capability[]>;

function defaultsCopy(): CapabilityMap {
  const copy = {} as CapabilityMap;
  for (const role of ROLES) copy[role] = [...DEFAULT_CAPABILITIES[role]];
  return copy;
}

// Effective capabilities: a role with stored rows uses exactly those
// (granted subset of ALL_CAPABILITIES); a role with no rows uses defaults.
// If the table isn't migrated yet, defaults are returned so nothing breaks.
export async function getEffectiveCapabilities(
  supabase: SupabaseClient,
  projectId: string
): Promise<CapabilityMap> {
  const { data, error } = await supabase
    .from("role_capabilities")
    .select("role, capability, granted")
    .eq("project_id", projectId);

  if (error || !data) return defaultsCopy();

  const stored = {} as Record<Role, Set<Capability>>;
  for (const row of data as { role: string; capability: string; granted: boolean }[]) {
    const role = row.role as Role;
    if (!ROLES.includes(role)) continue;
    if (!row.granted) continue;
    if (!ALL_CAPABILITIES.includes(row.capability as Capability)) continue;
    (stored[role] ??= new Set()).add(row.capability as Capability);
  }

  const effective = defaultsCopy();
  for (const role of ROLES) {
    if (stored[role]) effective[role] = [...stored[role]];
  }
  return effective;
}

export async function assertCapability(
  supabase: SupabaseClient,
  projectId: string,
  role: Role,
  capability: Capability
): Promise<void> {
  const effective = await getEffectiveCapabilities(supabase, projectId);
  if (!effective[role].includes(capability)) {
    throw new CapabilityError(role, capability);
  }
}

export async function assertRoleAllowed(
  supabase: SupabaseClient,
  projectId: string,
  role: Role,
  capability: Capability
): Promise<boolean> {
  try {
    await assertCapability(supabase, projectId, role, capability);
    return true;
  } catch {
    return false;
  }
}

// Saves a complete desired state: every role's full capability list. Rows
// are written for all (role, capability) pairs so a role the user has
// edited is stored explicitly; untouched roles keep using defaults.
export async function saveCapabilities(
  supabase: SupabaseClient,
  projectId: string,
  desired: Partial<CapabilityMap>
): Promise<void> {
  const rows: { project_id: string; role: Role; capability: Capability; granted: boolean }[] = [];
  for (const role of ROLES) {
    const grantedList = desired[role];
    if (!grantedList) continue; // role untouched — leave defaults in effect
    for (const capability of ALL_CAPABILITIES) {
      rows.push({ project_id: projectId, role, capability, granted: grantedList.includes(capability) });
    }
  }

  if (!rows.length) return;

  const { error } = await supabase
    .from("role_capabilities")
    .upsert(rows, { onConflict: "project_id,role,capability" });
  if (error) throw new Error(`Failed to save capabilities: ${error.message}`);
}

// Approval-gating setting: stored on projects.require_approval (default
// true). If the column isn't migrated yet we fail safe to the spec default.
export async function getRequireApproval(
  supabase: SupabaseClient,
  projectId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("projects")
    .select("require_approval")
    .eq("id", projectId)
    .single();
  if (error || !data) return true;
  return data.require_approval !== false;
}

export async function setRequireApproval(
  supabase: SupabaseClient,
  projectId: string,
  value: boolean
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ require_approval: value })
    .eq("id", projectId);
  if (error) throw new Error(`Failed to save setting: ${error.message}`);
}
