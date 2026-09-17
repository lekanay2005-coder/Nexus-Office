const GITHUB_API = "https://api.github.com";

export interface PushFile {
  path: string;
  content: string;
}

export interface PushResult {
  commitSha: string;
  branch: string;
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
  message: string
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
