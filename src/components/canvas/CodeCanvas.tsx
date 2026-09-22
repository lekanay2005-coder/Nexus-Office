"use client";

import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { injectWatermark } from "@/lib/brand";
import type { ProjectFile } from "@/types/db";

function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    py: "python",
  };
  return map[ext] ?? "plaintext";
}

export default function CodeCanvas({
  projectId,
  initialFiles,
  showWatermark = true,
}: {
  projectId: string;
  initialFiles: ProjectFile[];
  showWatermark?: boolean;
}) {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialFiles[0]?.path ?? null);
  const [draft, setDraft] = useState<string>(initialFiles[0]?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const selected = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath]
  );

  function selectFile(path: string) {
    setSelectedPath(path);
    setDraft(files.find((f) => f.path === path)?.content ?? "");
  }

  async function refreshFiles() {
    const res = await fetch(`/api/projects/${projectId}/files`);
    if (!res.ok) return;
    const data = await res.json();
    const nextFiles: ProjectFile[] = data.files ?? [];
    setFiles(nextFiles);
    const stillSelected = nextFiles.find((f) => f.path === selectedPath);
    if (stillSelected) {
      setDraft(stillSelected.content);
    } else if (nextFiles[0]) {
      setSelectedPath(nextFiles[0].path);
      setDraft(nextFiles[0].content);
    }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selected.path, content: draft }),
    });
    if (res.ok) {
      const data = await res.json();
      setFiles((prev) => prev.map((f) => (f.path === data.file.path ? data.file : f)));
    }
    setSaving(false);
  }

  useEffect(() => {
    // Refetch whenever the canvas remounts (parent bumps its key after a
    // pipeline run writes new files) so the Builder's output shows up
    // without a manual refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watermark is appended to the iframe srcdoc at render time only — the
  // underlying file contents are never modified.
  const previewHtml = useMemo(
    () => (showWatermark ? injectWatermark(buildPreviewHtml(files)) : buildPreviewHtml(files)),
    [files, showWatermark]
  );

  return (
    <div className="flex h-full">
      {/* File tree */}
      <div className="w-56 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Files
          </span>
          <button
            onClick={refreshFiles}
            className="text-[11px] text-neutral-500 hover:text-neutral-300"
          >
            Refresh
          </button>
        </div>
        {files.length === 0 && (
          <p className="px-1 text-xs text-neutral-600">
            No files yet — ask the Builder to create something in Office Chat.
          </p>
        )}
        <ul className="space-y-0.5">
          {files.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => selectFile(f.path)}
                className={`w-full truncate rounded px-2 py-1 text-left text-xs ${
                  f.path === selectedPath
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
                title={f.path}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
          <span className="truncate text-xs text-neutral-400">
            {selected?.path ?? "No file selected"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            >
              {showPreview ? "Hide preview" : "Show preview"}
            </button>
            <button
              onClick={handleSave}
              disabled={!selected || saving}
              className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className={showPreview ? "w-1/2 min-w-0" : "w-full min-w-0"}>
            {selected ? (
              <Editor
                height="100%"
                theme="vs-dark"
                path={selected.path}
                language={languageForPath(selected.path)}
                value={draft}
                onChange={(v) => setDraft(v ?? "")}
                options={{ minimap: { enabled: false }, fontSize: 13 }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-600">
                Select a file to edit
              </div>
            )}
          </div>

          {showPreview && (
            <div className="w-1/2 min-w-0 border-l border-neutral-800">
              <iframe
                title="Live preview"
                srcDoc={previewHtml}
                sandbox="allow-scripts"
                className="h-full w-full bg-white"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Best-effort static preview: renders an index.html file if present, or
// wraps a single HTML-ish file. This is intentionally simple for the MVP —
// full bundling of a Next.js project tree is out of scope for the canvas.
function buildPreviewHtml(files: ProjectFile[]): string {
  const index = files.find((f) => /(^|\/)index\.html$/.test(f.path));
  if (index) return index.content;

  const html = files.find((f) => f.path.endsWith(".html"));
  if (html) return html.content;

  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;color:#666">
    <p>No index.html found in this project's files yet.</p>
  </body></html>`;
}
