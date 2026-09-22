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

async function gh(token: string, path: string, init?: RequestInit) {
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
    const ref = await refRes.json();
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

  const ref = await refRes.json();
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

  const data = await res.json();
  if (data.encoding !== "base64") throw new Error(`Unexpected encoding for ${path}: ${data.encoding}`);
  return Buffer.from(data.content, "base64").toString("utf8");
}
