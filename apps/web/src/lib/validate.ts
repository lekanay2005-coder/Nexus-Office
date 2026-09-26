// Addendum 13 section 5: pre-push validation.
//
// Before any auto-commit/push to GitHub (project code from Builder, manual
// edits, Prompt Vault changes), every file passes a lightweight validation
// pass. Code files get a syntax/structure check appropriate to their type;
// JSON files must parse, full stop. Failed files are NOT pushed.
//
// Design notes:
// - Zero new dependencies: full typecheck/lint runs exist in CI, but a push
//   happens at runtime inside a serverless function, so we do fast parse-
//   level checks here (brace/paren/tag balance, obviously-truncated files).
//   Anything ambiguous passes — false negatives that block pushes are worse
//   than letting a marginal file through.
// - Returns issues, doesn't throw: the caller (sync route) decides whether
//   to route back through Analyst/QA or surface the error.

export interface ValidationIssue {
  path: string;
  kind: "json" | "code" | "html" | "css";
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  checked: number;
}

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "py", "rb", "go", "rs", "java",
]);

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

// Counts net delimiter balance for a pair, ignoring string literals and
// comments where practical. Good enough to catch truncated or mangled files.
function balanceOf(content: string, open: string, close: string): number {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0;
  let prev = "";

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      prev = ch;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      prev = ch;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        prev = ch;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        prev = ch;
        continue;
      }
    }
    if (inDouble && ch === '"' && prev !== "\\") inDouble = false;
    else if (inSingle && ch === "'" && prev !== "\\") inSingle = false;
    else if (inTemplate && ch === "`" && prev !== "\\") inTemplate = false;
    else if (!inSingle && !inDouble && !inTemplate) {
      if (ch === '"') inDouble = true;
      else if (ch === "'") inSingle = true;
      else if (ch === "`") inTemplate = true;
      else if (ch === open) depth++;
      else if (ch === close) depth--;
    }
    prev = ch;
  }
  return depth;
}

// HTML tag balance: strips comments and void/self-closing tags, then counts
// open vs close for the common structural tags.
function htmlTagIssues(content: string): string[] {
  const problems: string[] = [];
  const cleaned = content.replace(/<!--[\s\S]*?-->/g, "");
  const voidTags = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);
  const counts = new Map<string, number>();
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const tag = m[1].toLowerCase();
    const full = m[0];
    if (voidTags.has(tag) || full.endsWith("/>")) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + (full.startsWith("</") ? -1 : 1));
  }
  for (const [tag, n] of counts) {
    if (n !== 0) {
      problems.push(`<${tag}> tags are unbalanced (net ${n > 0 ? "unclosed" : "extra closing"}: ${Math.abs(n)})`);
    }
  }
  return problems;
}

export function validateFile(path: string, content: string): ValidationIssue | null {
  const ext = extOf(path);

  // JSON must parse. No leniency — malformed JSON never gets committed
  // (Prompt Vault files live under this rule too).
  if (ext === "json" || path.endsWith(".json")) {
    try {
      JSON.parse(content);
      return null;
    } catch (err) {
      return {
        path,
        kind: "json",
        message: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
      };
    }
  }

  if (ext === "html" || ext === "htm") {
    const problems = htmlTagIssues(content);
    if (problems.length > 0) {
      return { path, kind: "html", message: problems.slice(0, 3).join("; ") };
    }
    return null;
  }

  if (ext === "css") {
    const braces = balanceOf(content, "{", "}");
    if (braces !== 0) {
      return { path, kind: "css", message: `CSS braces are unbalanced (net ${braces > 0 ? "unclosed {" : "extra }"}: ${Math.abs(braces)})` };
    }
    return null;
  }

  if (CODE_EXT.has(ext)) {
    // Python uses different delimiters for blocks; only check parens/brackets.
    if (ext === "py") {
      const parens = balanceOf(content, "(", ")");
      const brackets = balanceOf(content, "[", "]");
      if (parens !== 0 || brackets !== 0) {
        return { path, kind: "code", message: `Unbalanced delimiters: () net ${parens}, [] net ${brackets}` };
      }
      return null;
    }
    const braces = balanceOf(content, "{", "}");
    const parens = balanceOf(content, "(", ")");
    if (braces !== 0 || parens !== 0) {
      return {
        path,
        kind: "code",
        message: `Syntax looks broken — braces net ${braces}, parens net ${parens} (check for truncated or mangled code)`,
      };
    }
    return null;
  }

  // Unknown types (md, txt, images, configs): pass through.
  return null;
}

export function validateFiles(files: { path: string; content: string }[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const f of files) {
    const issue = validateFile(f.path, f.content);
    if (issue) issues.push(issue);
  }
  return { ok: issues.length === 0, issues, checked: files.length };
}
