import {
  commitVaultFile,
  ensureVaultRepo,
  getDefaultBranchHeadSha,
  getFileContentAtRef,
  listVaultPrompts,
  serializeVaultPrompt,
  slugForPrompt,
  type CommitAuthor,
  type VaultPrompt,
} from "@nexus/github-sync";

// Addendum 13 Phase 1: the Prompt Vault's GitHub-backed storage.
//
// Storage lives in @nexus/github-sync (shared with the CLI, which reads the
// same `nexus-office-prompt-vault` repo via `nexus vault list` / `use`).
// This module keeps the web-specific glue: the cache-row mapper and the
// legacy-markdown migration sweep that touches the Supabase prompts table.

export {
  commitVaultFile,
  ensureVaultRepo,
  listVaultPrompts,
  serializeVaultPrompt,
  slugForPrompt,
};

export type { VaultPrompt };

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
    .filter((t) => t.type === "blob" && t.path.startsWith("prompts/") && t.path.endsWith(".md"))
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
        file: { slug: mdPath.replace("prompts/", "").replace(/\.md$/, ""), content: null },
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
