import type { SupabaseClient } from "@supabase/supabase-js";
import { extractFilesFromBuilderOutput } from "@/lib/pipeline/extractFiles";
import { logAudit } from "@/lib/audit";

// Addendum 17: agent isolation (anti-spoilage).
//
// The files table is the user's "working state" (Code Canvas + GitHub sync
// read from it). A pipeline run must never write to it directly. Instead:
//
//   1. Before the Builder runs, a File Scoper LLM sub-step declares the set
//      of paths the work SHOULD touch (declared_scope).
//   2. Builder writes land in a per-run run_snapshots row (the isolated
//      "branch" — nexus/run-<id> conceptually), never in files.
//   3. After the Builder finishes, scope enforcement diffs written paths
//      against the declared scope. Any file outside scope → the run's output
//      is rejected (one retry with the violation flagged; second violation
//      stops the run and hands it to the user).
//   4. Once QA/Ops complete and scope is ok, the snapshot is either applied
//      automatically (default: require_merge_approval off) or held at
//      "ready" for review-before-merge, where the UI shows the per-file diff.
//   5. "Undo last run" restores base_files — trivial because nothing was
//      ever merged until step 4.
//
// Parallel-run safety: each run gets its own snapshot row keyed by run_id;
// two concurrent runs hold two independent snapshots and can never touch
// each other. Both stay visible in the UI until each is merged/rejected.

export interface SnapshotFileEntry {
  path: string;
  content: string;
}

export interface RunSnapshotRow {
  id: string;
  run_id: string;
  project_id: string;
  declared_scope: string[];
  written_paths: string[];
  violations: string[];
  scope_status: "pending" | "ok" | "rejected";
  status: "pending" | "ready" | "applied" | "rejected" | "undone";
  base_files: SnapshotFileEntry[];
  files: SnapshotFileEntry[];
  created_at: string;
  updated_at: string;
}

// --- Scope declaration -----------------------------------------------------

/**
 * File Scoper: an LLM sub-step that reads the user's message + the
 * Strategist's plan and declares exactly which paths the Builder may touch.
 * Uses the same provider stack as the roles (respects NEXUS_MOCK_LLM) but
 * with a cheap single completion and a strict fenced-JSON contract.
 *
 * The Builder's prompt embeds this list as a hard constraint, and scope
 * enforcement diffs against it afterwards. If the Scoper itself fails
 * (provider error, malformed output), we fall back to an empty scope with
 * enforcement disabled rather than blocking the run — the snapshot still
 * isolates every write, so worst case the user reviews before merge.
 */
export async function declareScope(args: {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  runId: string;
  userMessage: string;
  direction: string;
}): Promise<string[]> {
  const { complete } = await import("@/lib/providers");
  const { DEFAULT_PROVIDER_CONFIG } = await import("@/lib/providers");
  const config = DEFAULT_PROVIDER_CONFIG;

  try {
    const result = await complete(config, {
      system: SCOPE_SYSTEM_PROMPT,
      prompt: [
        "USER REQUEST:",
        args.userMessage,
        "",
        "PLAN:",
        args.direction,
      ].join("\n"),
    });

    const parsed = parseScopeOutput(result.text);
    await logAudit(args.supabase, {
      projectId: args.projectId,
      userId: args.userId,
      actor: "system",
      action: "scope.declared",
      target: args.runId,
      metadata: { paths: parsed },
    });
    return parsed;
  } catch {
    // Scoper failed — proceed with no declared scope. Enforcement becomes a
    // no-op (allow-list empty + enforcement disabled flag below), but every
    // write is still snapshot-isolated and reviewable before merge.
    await logAudit(args.supabase, {
      projectId: args.projectId,
      userId: args.userId,
      actor: "system",
      action: "scope.declare_failed",
      target: args.runId,
      metadata: {},
    });
    return [];
  }
}

const SCOPE_SYSTEM_PROMPT = `You are the File Scoper for a 5-person AI dev team inside Nexus Office.
Given the user's request and the plan, list the exact file paths the Builder may
create or modify to fulfill it. Be precise and minimal: include every file the
plan genuinely requires (and direct imports that must change with it), but
nothing else. Absolute paths are not allowed; use project-relative paths like
src/app/page.tsx or index.html.

End your reply with a fenced JSON block in exactly this format:

\`\`\`scope
{ "paths": ["index.html"] }
\`\`\``;

function parseScopeOutput(text: string): string[] {
  const match = /```scope\n([\s\S]*?)```/.exec(text);
  if (!match) return [];
  try {
    const raw = JSON.parse(match[1]) as { paths?: unknown };
    if (!Array.isArray(raw.paths)) return [];
    return Array.from(
      new Set(
        raw.paths
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim().replace(/^\.?\//, ""))
          .filter(Boolean)
      )
    );
  } catch {
    return [];
  }
}

// --- Snapshot lifecycle ------------------------------------------------------

export async function createSnapshot(args: {
  supabase: SupabaseClient;
  projectId: string;
  runId: string;
  declaredScope: string[];
}): Promise<void> {
  const { error } = await args.supabase.from("run_snapshots").insert({
    run_id: args.runId,
    project_id: args.projectId,
    declared_scope: args.declaredScope,
    base_files: [],
    files: [],
  });
  if (error) {
    // Non-fatal: isolation degrades to direct writes only if this fails,
    // which the run loop detects via snapshotExists.
    console.warn("[isolation] snapshot create failed:", error.message);
  }
}

export async function getSnapshot(
  supabase: SupabaseClient,
  runId: string
): Promise<RunSnapshotRow | null> {
  const { data } = await supabase
    .from("run_snapshots")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();
  return (data as RunSnapshotRow | null) ?? null;
}

/**
 * The Builder's writes for this run, extracted from its output. Captured in
 * memory by the run loop and written into the snapshot row — never into files.
 */
export function builderFilesFromOutput(builderOutput: string): SnapshotFileEntry[] {
  return extractFilesFromBuilderOutput(builderOutput).map((f) => ({
    path: f.path,
    content: f.content,
  }));
}

/**
 * Captures the Builder's writes + the pre-run base state into the snapshot.
 * base_files records the prior content of every path the run touched, so a
 * later diff (and undo) is exact even if unrelated files changed since.
 */
export async function captureSnapshotWrites(args: {
  supabase: SupabaseClient;
  projectId: string;
  runId: string;
  builderFiles: SnapshotFileEntry[];
}): Promise<RunSnapshotRow | null> {
  const snapshot = await getSnapshot(args.supabase, args.runId);
  if (!snapshot) return null;

  const touchedPaths = args.builderFiles.map((f) => f.path);
  const { data: baseRows, error } = await args.supabase
    .from("files")
    .select("path, content")
    .eq("project_id", args.projectId)
    .in("path", touchedPaths.length ? touchedPaths : ["__none__"]);

  if (error) {
    console.warn("[isolation] base file load failed:", error.message);
  }
  const baseFiles: SnapshotFileEntry[] = (baseRows ?? []).map((r) => ({
    path: r.path,
    content: r.content,
  }));

  const { data: updated, error: updateError } = await args.supabase
    .from("run_snapshots")
    .update({
      written_paths: touchedPaths,
      files: args.builderFiles,
      base_files: baseFiles,
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", args.runId)
    .select()
    .single();

  if (updateError) {
    console.warn("[isolation] snapshot capture failed:", updateError.message);
    return null;
  }
  return updated as RunSnapshotRow;
}

export interface ScopeEnforcementResult {
  /** Paths the Builder wrote that were NOT in the declared scope. */
  violations: string[];
  /** True when scope checking is meaningful (a scope was declared). */
  enforced: boolean;
  /** Updated snapshot row, or null when there is no snapshot. */
  snapshot: RunSnapshotRow | null;
}

/**
 * Scope enforcement: diff the Builder's written paths against the File
 * Scoper's declared scope. Violations are recorded on the snapshot and
 * audit-logged; the run loop decides retry vs. block.
 */
export async function enforceScope(args: {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  runId: string;
  builderFiles: SnapshotFileEntry[];
  declaredScope: string[];
}): Promise<ScopeEnforcementResult> {
  const enforced = args.declaredScope.length > 0;
  const scopeSet = new Set(args.declaredScope);
  const violations = enforced
    ? args.builderFiles.filter((f) => !scopeSet.has(f.path)).map((f) => f.path)
    : [];

  const snapshot = await getSnapshot(args.supabase, args.runId);
  if (snapshot) {
    await args.supabase
      .from("run_snapshots")
      .update({
        violations,
        scope_status: enforced ? (violations.length ? "rejected" : "ok") : "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", args.runId);
  }

  if (violations.length) {
    await logAudit(args.supabase, {
      projectId: args.projectId,
      userId: args.userId,
      actor: "system",
      action: "scope.violation",
      target: args.runId,
      metadata: { violations, declaredScope: args.declaredScope },
    });
  }

  return { violations, enforced, snapshot };
}

/** Marks the run's snapshot rejected (scope failed twice, or user rejected). */
export async function rejectSnapshot(
  supabase: SupabaseClient,
  runId: string
): Promise<void> {
  await supabase
    .from("run_snapshots")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("run_id", runId);
  await supabase
    .from("pipeline_runs")
    .update({ merge_status: "rejected" })
    .eq("id", runId);
}

/**
 * Readies the snapshot after QA/Ops: applies it immediately (auto-merge,
 * default) unless the project requires merge approval, in which case it
 * waits at "ready" with its diff visible in the UI.
 */
export async function finalizeSnapshot(args: {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  runId: string;
  requireMergeApproval: boolean;
}): Promise<{ applied: boolean; status: "applied" | "ready" | "rejected" }> {
  const snapshot = await getSnapshot(args.supabase, args.runId);
  if (!snapshot) return { applied: false, status: "rejected" };
  if (snapshot.scope_status === "rejected" || snapshot.status === "rejected") {
    return { applied: false, status: "rejected" };
  }

  await args.supabase
    .from("run_snapshots")
    .update({ status: "ready", updated_at: new Date().toISOString() })
    .eq("run_id", args.runId);

  if (args.requireMergeApproval) {
    await args.supabase
      .from("pipeline_runs")
      .update({ merge_status: "ready" })
      .eq("id", args.runId);
    await logAudit(args.supabase, {
      projectId: args.projectId,
      userId: args.userId,
      actor: "system",
      action: "merge.awaiting_approval",
      target: args.runId,
      metadata: {},
    });
    return { applied: false, status: "ready" };
  }

  const result = await applySnapshot(args.supabase, args.projectId, args.runId);
  return { applied: result.applied, status: result.applied ? "applied" : "rejected" };
}

// --- Diff summary (review-before-merge UI + CLI) -----------------------------

export interface SnapshotDiffFile {
  path: string;
  before: string | null;
  after: string | null;
  added: number;
  removed: number;
}

export interface SnapshotDiffSummary {
  runId: string;
  snapshotId: string | null;
  status: RunSnapshotRow["status"];
  scopeStatus: RunSnapshotRow["scope_status"];
  declaredScope: string[];
  violations: string[];
  files: SnapshotDiffFile[];
  totalAdded: number;
  totalRemoved: number;
}

/**
 * Per-file diff summary for the review-before-merge UI and `nexus chat`.
 * Line counts use the shared prefix/suffix trim from @nexus/github-sync.
 */
export async function getSnapshotDiff(
  supabase: SupabaseClient,
  projectId: string,
  runId: string
): Promise<SnapshotDiffSummary | null> {
  const snapshot = await getSnapshot(supabase, runId);
  if (!snapshot) return null;

  const { diffFile } = await import("@nexus/github-sync");
  const files = snapshot.files.map((f) =>
    diffFile({
      path: f.path,
      before: snapshot.base_files.find((b) => b.path === f.path)?.content ?? null,
      after: f.content,
    })
  );

  return {
    runId,
    snapshotId: snapshot.id,
    status: snapshot.status,
    scopeStatus: snapshot.scope_status,
    declaredScope: snapshot.declared_scope ?? [],
    violations: snapshot.violations ?? [],
    files,
    totalAdded: files.reduce((sum, f) => sum + f.added, 0),
    totalRemoved: files.reduce((sum, f) => sum + f.removed, 0),
  };
}

// --- Merge & undo ------------------------------------------------------------

/**
 * Applies the snapshot's isolated writes into the files table — the "merge"
 * of the run's branch into the user's working state. Only paths in the
 * snapshot's files list are written.
 *
 * Addendum 13 × 17 consistency: the candidate files are validated with the
 * SAME pre-push validator the GitHub sync route uses — but here it runs on
 * the snapshot's content BEFORE anything touches the files table, so broken
 * output is rejected at the merge gate, not discovered at push time.
 */
export async function applySnapshot(
  supabase: SupabaseClient,
  projectId: string,
  runId: string
): Promise<{ applied: boolean; filesApplied: number; validationError?: string }> {
  const snapshot = await getSnapshot(supabase, runId);
  if (!snapshot || !snapshot.files.length) {
    // Nothing to merge (e.g. a direct-mode run) — mark applied trivially.
    await supabase
      .from("pipeline_runs")
      .update({ merge_status: "applied" })
      .eq("id", runId);
    return { applied: true, filesApplied: 0 };
  }

  const { validateFiles } = await import("@/lib/validate");
  const validation = validateFiles(snapshot.files);
  if (!validation.ok) {
    await supabase
      .from("run_snapshots")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("run_id", runId);
    await supabase
      .from("pipeline_runs")
      .update({ merge_status: "rejected" })
      .eq("id", runId);
    return {
      applied: false,
      filesApplied: 0,
      validationError:
        "Merge blocked: the run's output failed pre-merge validation — " +
        validation.issues.map((i) => `${i.path} (${i.message})`).join("; "),
    };
  }

  const { error } = await supabase.from("files").upsert(
    snapshot.files.map((f) => ({
      project_id: projectId,
      path: f.path,
      content: f.content,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "project_id,path" }
  );
  if (error) {
    console.warn("[isolation] snapshot apply failed:", error.message);
    return { applied: false, filesApplied: 0 };
  }

  await supabase
    .from("run_snapshots")
    .update({ status: "applied", updated_at: new Date().toISOString() })
    .eq("run_id", runId);
  await supabase
    .from("pipeline_runs")
    .update({ merge_status: "applied" })
    .eq("id", runId);

  return { applied: true, filesApplied: snapshot.files.length };
}

/**
 * Rejected by the user after review: discard the snapshot's writes. Files
 * were never touched (snapshot was never applied), so nothing to revert.
 */
export async function discardSnapshot(
  supabase: SupabaseClient,
  runId: string
): Promise<void> {
  await rejectSnapshot(supabase, runId);
}

/**
 * Undo: restore every path the run touched to its pre-run content
 * (base_files). Paths the run created are deleted. Only valid for a run
 * whose snapshot is currently applied.
 */
export async function undoSnapshot(
  supabase: SupabaseClient,
  projectId: string,
  runId: string
): Promise<{ undone: boolean; message: string }> {
  const snapshot = await getSnapshot(supabase, runId);
  if (!snapshot) {
    return { undone: false, message: "This run has no isolated snapshot to undo." };
  }
  if (snapshot.status !== "applied") {
    return {
      undone: false,
      message: `Only an applied run can be undone (this one is "${snapshot.status}").`,
    };
  }

  // Restore prior content for paths that existed before.
  const restores = snapshot.base_files.filter(
    (f) => !snapshot.files.some((w) => w.path === f.path && w.content === f.content)
  );
  if (restores.length) {
    const { error } = await supabase.from("files").upsert(
      restores.map((f) => ({
        project_id: projectId,
        path: f.path,
        content: f.content,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "project_id,path" }
    );
    if (error) return { undone: false, message: `Undo failed: ${error.message}` };
  }

  // Delete files the run created (no prior content).
  const createdPaths = snapshot.files
    .map((f) => f.path)
    .filter((p) => !snapshot.base_files.some((b) => b.path === p));
  for (const path of createdPaths) {
    const { error } = await supabase
      .from("files")
      .delete()
      .eq("project_id", projectId)
      .eq("path", path);
    if (error) return { undone: false, message: `Undo failed: ${error.message}` };
  }

  await supabase
    .from("run_snapshots")
    .update({ status: "undone", updated_at: new Date().toISOString() })
    .eq("run_id", runId);
  await supabase
    .from("pipeline_runs")
    .update({ merge_status: "undone" })
    .eq("id", runId);

  const message = createdPaths.length
    ? `Undid run: restored ${restores.length} file(s), removed ${createdPaths.length} created file(s).`
    : `Undid run: restored ${restores.length} file(s) to their pre-run state.`;
  return { undone: true, message };
}
