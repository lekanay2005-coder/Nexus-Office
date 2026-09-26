export interface ExtractedFile {
  path: string;
  content: string;
}

// Matches ```path=some/file.tsx\n...content...\n```
const FILE_BLOCK_RE = /```path=([^\n`]+)\n([\s\S]*?)```/g;

export function extractFilesFromBuilderOutput(output: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  let match: RegExpExecArray | null;
  while ((match = FILE_BLOCK_RE.exec(output)) !== null) {
    const path = match[1].trim();
    const content = match[2].replace(/\n$/, "");
    if (path) files.push({ path, content });
  }
  return files;
}
