// Pure (no I/O) diff helpers shared by the web app and the CLI.

export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface FileDiff extends FileChange {
  added: number;
  removed: number;
}

function lineCount(text: string | null): number {
  if (text === null || text === "") return 0;
  return text.split("\n").length;
}

// Line-based diff summary for a single file. For new files every line counts
// as added; for deletions every line counts as removed. For modifications a
// shared-prefix/suffix trim keeps the counts honest without a full LCS.
export function diffFile(change: FileChange): FileDiff {
  if (change.before === null) {
    return { ...change, added: lineCount(change.after), removed: 0 };
  }
  if (change.after === null) {
    return { ...change, added: 0, removed: lineCount(change.before) };
  }
  if (change.before === change.after) {
    return { ...change, added: 0, removed: 0 };
  }

  const a = change.before.split("\n");
  const b = change.after.split("\n");

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removed = a.length - prefix - suffix;
  const added = b.length - prefix - suffix;
  return { ...change, added, removed };
}

// One-line summary like "src/app/page.tsx (+12 −3)", "+48 −0 (new file)".
export function formatDiffLine(d: FileDiff): string {
  const kind =
    d.before === null ? " (new file)" : d.after === null ? " (deleted)" : "";
  return `${d.path} (+${d.added} −${d.removed})${kind}`;
}
