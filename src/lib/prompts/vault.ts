import {
  getDefaultBranchHeadSha,
  getFileContentAtRef,
  pushFilesToGitHub,
  type CommitAuthor,
  type PushFile,
} from "@/lib/deploy/github";

// Addendum 13 Phase 1: the Prompt Vault's GitHub-backed storage.
//
// Storage format: one JSON file per prompt under `prompts/<slug>.json` in the
// user's `nexus-office-prompt-vault` repo — one file per prompt keeps commits
// clean ("Add prompt: <title>" touches exactly one file) and diffs readable.
//
// Schema per file (exactly the Addendum 13 contract):
//   { id, title, tags: [], body, visibility: 'private' | 'public',
//     created_at, updated_at, author_display_name }
//
// The prompts table in Supabase remains the fast, queryable cache (and holds
// visibility for the Explore board); the GitHub repo is the durable source of
// truth. Legacy `.md` prompts from the old structure are migrated to JSON on
// first sync (migrateLegacyMarkdownPrompts) — nothing is lost.

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

export function toVaultPrompt(row: {
  id: string;
  title: string;
  body: string;
  tags: string[] | null;
  visibility?: string | null;
  created_at: string;
  updated_at: string;
  author_display_name?: string | null;
}): VaultPrompt {
  return {
    id: row.id,
    title: row.title,
    tags: row.tags ?? [],
    body: row.body,
    visibility: row.visibility === "public" ? "public" : "private",
    created_at: row.created_at,
    updated_at: row.updated_at,
    author_display_name: row.author_display_name ?? "",
  };
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
  const check = await fetch(`https://api.github.com/repos/${encodeURIComponent(login)}/${VAULT_REPO_NAME}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (check.ok) {
    const repo = await check.json();
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
  const repo = await create.json();
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
      const tree = await treeRes.json();
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
      const newTree = await res.json();

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
      const c = await commitRes.json();
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

// Lists every prompt JSON file currently in the vault. Used for the
// legacy-.md migration sweep and for future full-rebuild reconciliations.
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
  const tree = await treeRes.json();

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

// One-time sweep: converts legacy `prompts/*.md` (markdown + frontmatter from
// the old structure) into JSON files, then deletes the .md originals. Best-
// effort per file — a failure on one prompt never blocks the others.
export async function migrateLegacyMarkdownPrompts(args: {
  token: string;
  repoFullName: string;
  author?: CommitAuthor;
}): Promise<{ migrated: number; failed: number }> {
  const { token, repoFullName, author } = args;
  const head = await getDefaultBranchHeadSha(token, repoFullName);
  if (!head.sha) return { migrated: 0, failed: 0 };

  const treeRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/trees/${head.sha}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (!treeRes.ok) return { migrated: 0, failed: 0 };
  const tree = await treeRes.json();

  const mdPaths = (tree.tree as Array<{ path: string; type: string }>)
    .filter((t) => t.type === "blob" && t.path.startsWith(`${VAULT_DIR}/`) && t.path.endsWith(".md"))
    .map((t) => t.path);

  let migrated = 0;
  let failed = 0;

  for (const mdPath of mdPaths) {
    try {
      const md = await getFileContentAtRef(token, repoFullName, mdPath, head.sha);
      if (!md) continue;

      // Old format: optional frontmatter (---\ntitle: ...\ntags: a, b\n---)
      // followed by the body.
      const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md);
      const meta: Record<string, string> = {};
      if (fm) {
        for (const line of fm[1].split("\n")) {
          const idx = line.indexOf(":");
          if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      const title = meta.title || mdPath.split("/").pop()!.replace(/\.md$/, "");
      const tags = (meta.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const id = meta.id ?? crypto.randomUUID();
      const now = new Date().toISOString();

      const vault: VaultPrompt = {
        id,
        title,
        tags,
        body,
        visibility: meta.visibility === "public" ? "public" : "private",
        created_at: meta.created_at ?? now,
        updated_at: now,
        author_display_name: meta.author_display_name ?? "",
      };

      await commitVaultFile({
        token,
        repoFullName,
        file: { slug: slugForPrompt(vault.id, vault.title), content: serializeVaultPrompt(vault) },
        message: `Migrate prompt to JSON: ${vault.title}`,
        author,
      });
      await commitVaultFile({
        token,
        repoFullName,
        file: { slug: mdPath.replace(`${VAULT_DIR}/`, "").replace(/\.md$/, ""), content: null },
        message: `Remove legacy markdown: ${vault.title}`,
        author,
      });
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  return { migrated, failed };
}
