import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDefaultBranchHeadSha,
  getFileContentAtRef,
  getAuthenticatedUser,
  pushFilesToGitHub,
  type CommitAuthor,
} from "./github";
import { getDecryptedApiKey } from "@/lib/apiKeys";
import { getOrCreateProfile } from "@/lib/profile";

export interface SyncConflict {
  path: string;
  base: string | null; // content at our last known synced commit
  ours: string; // current content in the files table
  theirs: string | null; // current content on GitHub's HEAD
}

export interface SyncPlanResult {
  status: "conflicts" | "ready";
  conflicts: SyncConflict[];
  // Paths that will be pushed as-is (ours) with no conflict.
  cleanPaths: string[];
  headSha: string | null;
  branch: string;
}

// Compares our project's `files` table against the repo's current HEAD,
// using the commit we last synced from as the common ancestor ("base") for
// a 3-way diff. Only paths we actually track in `files` are considered —
// anything else already in the repo (e.g. the app's own source, for a
// project deliberately pointed at that same repo) is left untouched by
// the underlying push, so it's out of scope here entirely.
export async function planGitHubSync(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<SyncPlanResult> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("github_repo, last_synced_commit_sha")
    .eq("id", projectId)
    .single();

  if (projectError || !project) throw new Error("Project not found");
  if (!project.github_repo) {
    throw new Error("Connect a GitHub repo first.");
  }

  const token = await getDecryptedApiKey(supabase, userId, "github");
  if (!token) {
    throw new Error("RECONNECT_GITHUB");
  }

  const { data: files, error: filesError } = await supabase
    .from("files")
    .select("path, content")
    .eq("project_id", projectId);
  if (filesError) throw new Error(`Failed to load files: ${filesError.message}`);

  let headSha: string;
  let branch: string;
  try {
    const head = await getDefaultBranchHeadSha(token, project.github_repo);
    branch = head.branch;
    headSha = head.sha ?? "";
  } catch (err) {
    if (err instanceof Error && /401|403/.test(err.message)) {
      throw new Error("RECONNECT_GITHUB");
    }
    throw err;
  }

  const lastSyncedSha: string | null = project.last_synced_commit_sha;

  // No prior sync, empty repo, or nothing has moved since our last push —
  // nothing can have diverged, so every local file is clean to push.
  if (!headSha || !lastSyncedSha || headSha === lastSyncedSha) {
    return {
      status: "ready",
      conflicts: [],
      cleanPaths: (files ?? []).map((f) => f.path),
      headSha: headSha || null,
      branch,
    };
  }

  const conflicts: SyncConflict[] = [];
  const cleanPaths: string[] = [];

  for (const file of files ?? []) {
    const [base, theirs] = await Promise.all([
      getFileContentAtRef(token, project.github_repo, file.path, lastSyncedSha),
      getFileContentAtRef(token, project.github_repo, file.path, headSha),
    ]);

    if (theirs === base) {
      // GitHub's copy of this path hasn't changed since our last sync —
      // whatever we have locally is safe to push.
      cleanPaths.push(file.path);
    } else if (theirs === file.content) {
      // They already match what we're about to push (converged already).
      cleanPaths.push(file.path);
    } else if (base === file.content) {
      // We never touched this file locally; they did. Don't push it —
      // leave their version in place (base_tree overlay preserves it).
      continue;
    } else {
      // Both sides changed this path since the common ancestor, and they
      // disagree. Real conflict — needs a user decision.
      conflicts.push({ path: file.path, base, ours: file.content, theirs });
    }
  }

  return {
    status: conflicts.length > 0 ? "conflicts" : "ready",
    conflicts,
    cleanPaths,
    headSha,
    branch,
  };
}

export interface ApplySyncArgs {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  // Required for every path returned as a conflict by planGitHubSync.
  resolutions: Record<string, "mine" | "theirs">;
}

export interface ApplySyncResult {
  commitSha: string;
  branch: string;
  url: string;
  filesPushed: number;
}

export async function applyGitHubSync({
  supabase,
  projectId,
  userId,
  resolutions,
}: ApplySyncArgs): Promise<ApplySyncResult> {
  const plan = await planGitHubSync(supabase, projectId, userId);

  const unresolved = plan.conflicts.filter((c) => !resolutions[c.path]);
  if (unresolved.length > 0) {
    throw new Error(
      `UNRESOLVED_CONFLICTS:${JSON.stringify(unresolved.map((c) => c.path))}`
    );
  }

  const { data: project } = await supabase
    .from("projects")
    .select("github_repo")
    .eq("id", projectId)
    .single();
  if (!project?.github_repo) throw new Error("Project not found");

  const { data: allFiles } = await supabase
    .from("files")
    .select("path, content")
    .eq("project_id", projectId);

  const contentByPath = new Map((allFiles ?? []).map((f) => [f.path, f.content]));

  const pathsToPush = new Set(plan.cleanPaths);
  const theirsWinners: { path: string; content: string }[] = [];

  for (const conflict of plan.conflicts) {
    if (resolutions[conflict.path] === "mine") {
      pathsToPush.add(conflict.path);
    } else if (conflict.theirs !== null) {
      // "theirs" wins: don't push this path (preserves the remote version),
      // and pull it back into our own files table so Code Canvas matches
      // what's actually in the repo now.
      theirsWinners.push({ path: conflict.path, content: conflict.theirs });
    }
  }

  if (theirsWinners.length > 0) {
    await supabase.from("files").upsert(
      theirsWinners.map((f) => ({
        project_id: projectId,
        path: f.path,
        content: f.content,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "project_id,path" }
    );
  }

  const filesToPush = Array.from(pathsToPush)
    .map((path) => ({ path, content: contentByPath.get(path) }))
    .filter((f): f is { path: string; content: string } => typeof f.content === "string");

  if (filesToPush.length === 0) {
    throw new Error("Nothing to push — every file already matches GitHub.");
  }

  const token = await getDecryptedApiKey(supabase, userId, "github");
  if (!token) throw new Error("RECONNECT_GITHUB");

  const commitMessage = await buildCommitMessage(supabase, projectId);

  // Addendum 9: attribute the commit to the user's display name when set,
  // using GitHub's canonical noreply email (id+login) so authorship links
  // to their account regardless of email-privacy settings. Best-effort —
  // attribution problems must never block a push.
  let author: CommitAuthor | undefined;
  try {
    const profile = await getOrCreateProfile(supabase, userId);
    if (profile.display_name) {
      const me = await getAuthenticatedUser(token);
      author = {
        name: profile.display_name,
        email: `${me.id}+${me.login}@users.noreply.github.com`,
      };
    }
  } catch {
    author = undefined;
  }

  const { commitSha, branch } = await pushFilesToGitHub(
    token,
    project.github_repo,
    filesToPush,
    commitMessage,
    author
  );

  await supabase
    .from("projects")
    .update({
      last_synced_commit_sha: commitSha,
      last_synced_to_github_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  return { commitSha, branch, url: `https://github.com/${project.github_repo}/commit/${commitSha}`, filesPushed: filesToPush.length };
}

// Exported for the approval-gating summary in the sync route.
export async function buildCommitMessage(supabase: SupabaseClient, projectId: string): Promise<string> {
  const { data: memory } = await supabase
    .from("project_memory")
    .select("decisions")
    .eq("project_id", projectId)
    .maybeSingle();

  const decisions = (memory?.decisions ?? []) as { text: string; created_at: string }[];
  const latest = decisions[decisions.length - 1];

  return latest ? `Nexus Office: ${latest.text}` : "Save from Nexus Office";
}
