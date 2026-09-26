import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKey } from "@/lib/apiKeys";
import {
  getDefaultBranchHeadSha,
  getFileContentAtRef,
  listOwnerRepos,
  listOwners,
} from "@/lib/deploy/github";
import { ROLES } from "@/types/db";

// Addendum 13 Phase 2: projects are created by importing an existing GitHub
// repo (in-app repo creation removed per spec). Pulls the repo's current
// default-branch file tree into the project's files table so Code Canvas,
// Office Chat, Memory Board, and Audit Log are all linked to the repo from
// the first load.
//
// Body: { repo: "owner/name" }
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "repo must be in owner/name form" }, { status: 400 });
  }

  const token = await getDecryptedApiKey(supabase, user.id, "github");
  if (!token) return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });

  // Guard: the token must actually be able to see this repo.
  const [owner] = repo.split("/");
  let owners: string[] = [];
  try {
    owners = (await listOwners(token)).map((o) => o.login);
  } catch {
    return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });
  }

  let visible = false;
  try {
    if (owners[0] === owner) {
      const personal = await listOwnerRepos(token, owner, owners[0]);
      visible = personal.some((r) => r.fullName === repo);
    } else if (owners.includes(owner)) {
      const orgRepos = await listOwnerRepos(token, owner, owners[0]);
      visible = orgRepos.some((r) => r.fullName === repo);
    }
  } catch {
    visible = false;
  }
  if (!visible) {
    return NextResponse.json(
      { error: "Repo not found with your GitHub token. Check the org access or reconnect GitHub." },
      { status: 403 }
    );
  }

  // Refuse double-imports: one Nexus project per repo.
  const { data: existing } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", user.id)
    .eq("github_repo", repo)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `This repo is already a project ("${existing.name}").`, projectId: existing.id },
      { status: 409 }
    );
  }

  const name = repo.split("/")[1];
  const head = await getDefaultBranchHeadSha(token, repo);

  const { data: project, error: insertError } = await supabase
    .from("projects")
    .insert({
      name,
      user_id: user.id,
      github_repo: repo,
      github_owner: owner,
      default_branch: head.branch,
      last_synced_commit_sha: head.sha,
      last_synced_to_github_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  await supabase.from("project_memory").insert({ project_id: project.id });
  await supabase.from("role_models").insert(
    ROLES.map((role) => ({
      project_id: project.id,
      role,
      provider: "nexus-shared",
      model: "",
    }))
  );

  // Pull the repo's current tree into Code Canvas (skip binaries by extension;
  // cap the count so a huge repo can't stall the request).
  const BINARY_EXT = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar",
    "mp4", "mp3", "wav", "woff", "woff2", "ttf", "eot", "wasm", "lock",
  ]);
  const MAX_FILES = 200;

  if (head.sha) {
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${repo}/git/trees/${head.sha}?recursive=1`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
      );
      if (treeRes.ok) {
        const tree = await treeRes.json();
        const blobs = (tree.tree as Array<{ path: string; type: string; size?: number }>)
          .filter(
            (t) =>
              t.type === "blob" &&
              (t.size ?? 0) < 200_000 &&
              !t.path.split("/").some((seg) => seg === "node_modules" || seg.startsWith("."))
          )
          .filter((t) => {
            const ext = t.path.split(".").pop()?.toLowerCase() ?? "";
            return !BINARY_EXT.has(ext);
          })
          .slice(0, MAX_FILES);

        const rows: { project_id: string; path: string; content: string; updated_at: string }[] = [];
        for (const blob of blobs) {
          try {
            const content = await getFileContentAtRef(token, repo, blob.path, head.sha!);
            if (content !== null) {
              rows.push({
                project_id: project.id,
                path: blob.path,
                content,
                updated_at: new Date().toISOString(),
              });
            }
          } catch {
            // Skip unreadable blobs — the repo remains the source of truth.
          }
        }
        if (rows.length > 0) {
          await supabase.from("files").upsert(rows, { onConflict: "project_id,path" });
        }
      }
    } catch {
      // Non-fatal: the project exists; the user can re-sync from Code Canvas.
    }
  }

  return NextResponse.json({ project }, { status: 201 });
}
