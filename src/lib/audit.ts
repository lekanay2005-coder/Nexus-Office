import type { SupabaseClient } from "@supabase/supabase-js";

// Audit log (Addendum 3): every meaningful action gets a row in
// audit_events — pipeline runs (per role), file writes, GitHub commits,
// deploys, integration key changes, model router changes, and every
// approval/rejection. Logging is strictly best-effort: it must never
// break the action it observes (e.g. if the table isn't migrated yet).

export type AuditActor =
  | "user"
  | "strategist"
  | "builder"
  | "analyst"
  | "qa"
  | "ops"
  | "system";

export interface AuditEntry {
  projectId: string;
  userId: string;
  actor: AuditActor;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAudit(
  supabase: SupabaseClient,
  entry: AuditEntry
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_events").insert({
      project_id: entry.projectId,
      user_id: entry.userId,
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) console.warn("[audit] insert failed:", error.message);
  } catch (err) {
    console.warn("[audit] insert threw:", err);
  }
}
