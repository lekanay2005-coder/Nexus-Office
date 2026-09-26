const GITHUB_API = "https://api.github.com";

export interface PushFile {
  path: string;
  content: string;
}

export interface PushResult {
  commitSha: string;
  branch: string;
}

// Addendum 9: explicit commit authorship — commits are attributed to the
// user's display name instead of the token's default. Email uses GitHub's
// canonical noreply format (id+login) so attribution links to their account
// regardless of email-privacy settings.
export interface CommitAuthor {
  name: string;
  email: string;
}

export async function getAuthenticatedUser(
  token: string
): Promise<{ login: string; id: number; name: string | null }> {
  const u = await gh(token, "/user");
  return { login: u.login as string, id: u.id as number, name: (u.name as string | null) ?? null };
}

// GitHub's JSON payloads are dynamically shaped and call sites narrow fields
// explicitly (`as string` etc.), so the helper returns `any` rather than
// `unknown` — a deliberate exception to the no-any rule for external JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gh(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

// Commits the current file set as a single new commit on the repo's default
// branch (or creates that branch's first commit if the repo is empty).
export async function pushFilesToGitHub(
  token: string,
  repoFullName: string,
  files: PushFile[],
  message: string,
  author?: CommitAuthor
): Promise<PushResult> {
  if (files.length === 0) {
    throw new Error("No files to push — build something in Office Chat or Code Canvas first.");
  }

  const repoInfo = await gh(token, `/repos/${repoFullName}`);
  const branch: string = repoInfo.default_branch ?? "main";

  let baseTreeSha: string | undefined;
  let parentSha: string | undefined;

  const refRes = await fetch(`${GITHUB_API}/repos/${repoFullName}/git/ref/heads/${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  if (refRes.ok) {
    const ref = (await refRes.json()) as { object: { sha: string } };
    parentSha = ref.object.sha;
    const commit = await gh(token, `/repos/${repoFullName}/git/commits/${parentSha}`);
    baseTreeSha = commit.tree.sha;
  } else if (refRes.status !== 404) {
    throw new Error(`GitHub API failed to read ref: ${refRes.status}`);
  }
  // 404 means an empty repo with no commits yet — push the first commit below.

  const tree = await gh(token, `/repos/${repoFullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    }),
  });

  const commit = await gh(token, `/repos/${repoFullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
      ...(author ? { author: { name: author.name, email: author.email } } : {}),
    }),
  });

  if (parentSha) {
    await gh(token, `/repos/${repoFullName}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
  } else {
    await gh(token, `/repos/${repoFullName}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return { commitSha: commit.sha as string, branch };
}

export interface GitHubRepoSummary {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
}

export async function listUserRepos(token: string): Promise<GitHubRepoSummary[]> {
  const repos = await gh(token, "/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator");
  return (repos as Array<Record<string, unknown>>).map((r) => ({
    fullName: r.full_name as string,
    private: r.private as boolean,
    defaultBranch: r.default_branch as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function createUserRepo(
  token: string,
  name: string,
  isPrivate: boolean
): Promise<GitHubRepoSummary> {
  const repo = await gh(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  });
  return {
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    updatedAt: repo.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Addendum 9 Phase 1: org/repo picker support
// ---------------------------------------------------------------------------

export interface GitHubOwner {
  login: string;
  type: "User" | "Organization";
}

// The user's personal account plus every org they belong to (/user/orgs).
// The personal account is always listed first.
export async function listOwners(token: string): Promise<GitHubOwner[]> {
  const me = await getAuthenticatedUser(token);
  const orgs = (await gh(token, "/user/orgs?per_page=100")) as Array<
    Record<string, unknown>
  >;
  return [
    { login: me.login, type: "User" },
    ...orgs.map((o) => ({ login: o.login as string, type: "Organization" as const })),
  ];
}

// Repos visible to the token under a specific owner. The user's own login
// uses /user/repos (includes collaborator repos); orgs use the public
// users/{org}/repos listing, which respects the token's granted access.
export async function listOwnerRepos(
  token: string,
  owner: string,
  personalLogin: string
): Promise<GitHubRepoSummary[]> {
  const path =
    owner === personalLogin
      ? "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator"
      : `/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=100`;
  const repos = await gh(token, path);
  return (repos as Array<Record<string, unknown>>).map((r) => ({
    fullName: r.full_name as string,
    private: r.private as boolean,
    defaultBranch: r.default_branch as string,
    updatedAt: r.updated_at as string,
  }));
}

// Creates a repo under an org (the personal variant is createUserRepo).
export async function createOrgRepo(
  token: string,
  owner: string,
  name: string,
  isPrivate: boolean
): Promise<GitHubRepoSummary> {
  const repo = await gh(token, `/orgs/${encodeURIComponent(owner)}/repos`, {
    method: "POST",
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  });
  return {
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    updatedAt: repo.updated_at,
  };
}

// Current HEAD commit sha of the repo's default branch, or null for an
// empty repo with no commits yet.
export async function getDefaultBranchHeadSha(
  token: string,
  repoFullName: string
): Promise<{ sha: string | null; branch: string }> {
  const repoInfo = await gh(token, `/repos/${repoFullName}`);
  const branch: string = repoInfo.default_branch ?? "main";

  const refRes = await fetch(`${GITHUB_API}/repos/${repoFullName}/git/ref/heads/${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  if (refRes.status === 404) return { sha: null, branch };
  if (!refRes.ok) throw new Error(`GitHub API failed to read ref: ${refRes.status}`);

  const ref = (await refRes.json()) as { object: { sha: string } };
  return { sha: ref.object.sha as string, branch };
}

// A file's content at a specific commit/ref, or null if it doesn't exist
// there. Used to build the 3-way (base/ours/theirs) diff for a path.
export async function getFileContentAtRef(
  token: string,
  repoFullName: string,
  path: string,
  ref: string
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API failed to read ${path}@${ref}: ${res.status}`);

  const data = (await res.json()) as { encoding: string; content: string };
  if (data.encoding !== "base64") throw new Error(`Unexpected encoding for ${path}: ${data.encoding}`);
  return Buffer.from(data.content, "base64").toString("utf8");
}

// ---------------------------------------------------------------------------
// Prompt Vault (Addendum 13) — lives here so the CLI can reuse it.
// ---------------------------------------------------------------------------

export const VAULT_REPO_NAME = "nexus-office-prompt-vault";
const VAULT_DIR = "prompts";

export interface VaultPrompt {
  id: string;
  title: string;
  tags: string[];
  body: string;
  visibility: "private" | "public";
  created_at: string;
  updated_at: string;
  author_display_name: string;
}

// GitHub slugs: lowercase, alphanumerics and single dashes. Suffix a short
// id fragment so renames/titles never collide.
export function slugForPrompt(id: string, title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const frag = id.replace(/-/g, "").slice(0, 8);
  return `${base || "prompt"}-${frag}`;
}

export function serializeVaultPrompt(p: VaultPrompt): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}

// Parse + validate a vault JSON file. Returns null for anything malformed —
// callers skip (never crash) on bad files, per the Addendum 13 validation rule.
export function parseVaultPrompt(json: string): VaultPrompt | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      typeof raw.title !== "string" ||
      typeof raw.body !== "string" ||
      !Array.isArray(raw.tags) ||
      (raw.visibility !== "public" && raw.visibility !== "private")
    ) {
      return null;
    }
    return {
      id: raw.id,
      title: raw.title,
      tags: (raw.tags as unknown[]).filter((t): t is string => typeof t === "string"),
      body: raw.body,
      visibility: raw.visibility,
      created_at: typeof raw.created_at === "string" ? raw.created_at : new Date(0).toISOString(),
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date(0).toISOString(),
      author_display_name:
        typeof raw.author_display_name === "string" ? raw.author_display_name : "",
    };
  } catch {
    return null;
  }
}

// The user's vault repo is created lazily on first prompt save.
export async function ensureVaultRepo(token: string, login: string): Promise<string> {
  const check = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(login)}/${VAULT_REPO_NAME}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (check.ok) {
    const repo = (await check.json()) as { full_name: string };
    return repo.full_name as string;
  }
  if (check.status !== 404) {
    throw new Error(`Vault repo lookup failed: ${check.status}`);
  }

  const create = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: VAULT_REPO_NAME,
      private: true,
      description: "Nexus Office Prompt Vault — one JSON file per prompt.",
      auto_init: true,
    }),
  });
  if (!create.ok) {
    const body = await create.text().catch(() => "");
    throw new Error(`Vault repo creation failed: ${create.status} ${body.slice(0, 200)}`);
  }
  const repo = (await create.json()) as { full_name: string };
  return repo.full_name as string;
}

export interface VaultCommitArgs {
  token: string;
  repoFullName: string;
  // content === null means "delete this file from the vault".
  file: { slug: string; content: string | null };
  message: string;
  author?: CommitAuthor;
}

// Single-file commit to the vault (add, update, or delete via content=null).
// Uses the same git data API as pushFilesToGitHub so authorship and history
// stay consistent with project pushes.
export async function commitVaultFile({
  token,
  repoFullName,
  file,
  message,
  author,
}: VaultCommitArgs): Promise<{ commitSha: string }> {
  const head = await getDefaultBranchHeadSha(token, repoFullName);
  const files: PushFile[] =
    file.content === null
      ? []
      : [{ path: `${VAULT_DIR}/${file.slug}.json`, content: file.content! }];

  if (file.content === null) {
    // Deletion: read the current tree, remove the blob path, commit the rest.
    const treeRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/trees/${head.sha}?recursive=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
    );
    if (treeRes.ok) {
      const tree = (await treeRes.json()) as { tree: Array<{ path: string; type: string; mode?: string; sha?: string }> };
      const kept = (tree.tree as Array<{ path: string; mode: string; type: string; sha?: string }>)
        .filter(
          (t) =>
            t.type === "blob" &&
            t.path !== `${VAULT_DIR}/${file.slug}.json` &&
            t.path.startsWith(`${VAULT_DIR}/`)
        )
        .map((t) => ({ path: t.path, mode: t.mode, type: "blob" as const, sha: t.sha! }));
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tree: kept }),
      });
      if (!res.ok) throw new Error(`Vault tree update failed: ${res.status}`);
      const newTree = (await res.json()) as { sha: string };

      const commitRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: head.sha ? [head.sha] : [],
          ...(author ? { author } : {}),
        }),
      });
      if (!commitRes.ok) throw new Error(`Vault commit failed: ${commitRes.status}`);
      const c = (await commitRes.json()) as { sha: string };
      await fetch(`https://api.github.com/repos/${repoFullName}/git/refs/heads/${head.branch}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sha: c.sha, force: false }),
      });
      return { commitSha: c.sha as string };
    }
    // Tree read failed — fall through to an empty push (nothing removed
    // remotely, but the row is already gone from the cache).
    return { commitSha: "" };
  }

  const result = await pushFilesToGitHub(token, repoFullName, files, message, author);
  return { commitSha: result.commitSha };
}

// Lists every prompt JSON file currently in the vault.
export async function listVaultPrompts(
  token: string,
  repoFullName: string
): Promise<VaultPrompt[]> {
  const head = await getDefaultBranchHeadSha(token, repoFullName);
  if (!head.sha) return [];

  const treeRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/trees/${head.sha}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (!treeRes.ok) return [];
  const tree = (await treeRes.json()) as { tree: Array<{ path: string; type: string; mode?: string; sha?: string }> };

  const paths = (tree.tree as Array<{ path: string; type: string }>)
    .filter((t) => t.type === "blob" && t.path.startsWith(`${VAULT_DIR}/`) && t.path.endsWith(".json"))
    .map((t) => t.path);

  const prompts: VaultPrompt[] = [];
  for (const path of paths) {
    const content = await getFileContentAtRef(token, repoFullName, path, head.sha);
    if (!content) continue;
    const parsed = parseVaultPrompt(content);
    if (parsed) prompts.push(parsed);
  }
  return prompts;
}
