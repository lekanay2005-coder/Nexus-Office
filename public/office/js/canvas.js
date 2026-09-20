// Code Canvas: recursive file tree from the /files API, CodeMirror 6 editor
// (via esm.sh CDN — no build step), debounced srcdoc live preview, and a
// real-API-driven sync pill.

import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.2?deps=@codemirror/state@6.5.2,@codemirror/view@6.36.8,@codemirror/language@6.10.8,@codemirror/commands@6.8.1,@codemirror/autocomplete@6.18.6,@codemirror/search@6.5.11,@codemirror/lint@6.8.5,@lezer/common@1.2.3,@lezer/highlight@1.2.1,@lezer/lr@1.4.2";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6.5.2";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.3?deps=@codemirror/state@6.5.2,@codemirror/view@6.36.8,@codemirror/language@6.10.8";
import { saveFile, listFiles } from "./api.js";
import { createSyncStatus } from "./sync.js";
import { showToast } from "./toast.js";
import { buildFileTree, debounce, CM_LANGUAGES, languageKeyForPath } from "./util.js";

export function createCodeCanvas(paneEl, { projectId }) {
  const wrap = document.createElement("div");
  wrap.className = "canvas-wrap";
  paneEl.append(wrap);

  const sync = createSyncStatus(wrap);
  sync.idle();

  // ---- Left: file tree ----
  const tree = document.createElement("nav");
  tree.className = "file-tree";
  tree.setAttribute("aria-label", "Project files");
  wrap.append(tree);

  // ---- Right: editor + preview ----
  const editorColumn = document.createElement("div");
  editorColumn.className = "editor-column";
  wrap.append(editorColumn);

  const toolbar = document.createElement("div");
  toolbar.className = "editor-toolbar";
  const pathLabel = document.createElement("span");
  pathLabel.className = "active-path";
  const savedDot = document.createElement("span");
  savedDot.className = "saved-dot";
  savedDot.title = "Saved";
  savedDot.setAttribute("aria-hidden", "true"); // sync pill announces save state
  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "btn small";
  previewBtn.textContent = "Show preview";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn small primary";
  saveBtn.textContent = "Save";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  toolbar.append(pathLabel, spacer, savedDot, previewBtn, saveBtn);
  editorColumn.append(toolbar);

  const editorRow = document.createElement("div");
  editorRow.style.cssText = "flex:1;display:flex;min-height:0;";
  editorColumn.append(editorRow);

  const cmHolder = document.createElement("div");
  cmHolder.className = "cm-holder";
  cmHolder.style.flex = "1";
  editorRow.append(cmHolder);

  const editorEmpty = document.createElement("div");
  editorEmpty.className = "editor-empty";
  editorEmpty.style.flex = "1";
  editorEmpty.textContent = "No files yet — ask the Builder to create something.";
  editorRow.append(editorEmpty);

  const previewPane = document.createElement("div");
  previewPane.className = "preview-pane";
  previewPane.style.display = "none";
  const previewFrame = document.createElement("iframe");
  previewFrame.title = "Live preview";
  previewFrame.setAttribute("sandbox", "allow-scripts");
  previewPane.append(previewFrame);
  editorRow.append(previewPane);

  // ---- State ----
  let files = [];
  let selectedPath = null;
  let draft = "";
  let showPreview = false;
  let view = null;
  const langCompartment = new Compartment();

  const refreshPreview = debounce(() => {
    if (!showPreview) return;
    previewFrame.srcdoc = buildPreviewHtml(files);
  }, 500);

  // Auto-save after typing pauses — drives the sync pill through its real
  // pending → success/error states.
  const persistDraft = debounce(() => persistNow(), 800);

  async function persistNow() {
    if (!selectedPath) return;
    sync.saving();
    try {
      await saveFile(projectId, selectedPath, draft);
      const row = files.find((f) => f.path === selectedPath);
      if (row) row.content = draft;
      sync.saved();
      savedDot.classList.remove("flash");
      void savedDot.offsetWidth; // restart the flash animation
      savedDot.classList.add("flash");
    } catch (err) {
      sync.failed(() => persistNow());
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    }
  }

  // ---- File tree ----
  function renderTree() {
    tree.textContent = "";
    const head = document.createElement("div");
    head.className = "tree-head";
    const label = document.createElement("span");
    label.textContent = "Files";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "btn small";
    refreshBtn.textContent = "↻";
    refreshBtn.title = "Refresh files";
    refreshBtn.setAttribute("aria-label", "Refresh files");
    refreshBtn.addEventListener("click", () => loadFiles(false));
    head.append(label, refreshBtn);
    tree.append(head);

    if (!files.length) {
      const hint = document.createElement("p");
      hint.className = "faint";
      hint.style.padding = "0 6px";
      hint.textContent = "Ask the Builder in Office Chat to create your first file.";
      tree.append(hint);
      return;
    }

    const root = buildFileTree(files);
    const list = document.createElement("ul");
    tree.append(list);
    renderFolder(root, list);
  }

  function renderFolder(folder, listEl) {
    const folders = [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const child of folders) {
      const li = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tree-row";
      row.setAttribute("aria-expanded", "false");
      const twisty = document.createElement("span");
      twisty.className = "twisty";
      twisty.textContent = "▶";
      twisty.setAttribute("aria-hidden", "true");
      row.append(twisty, document.createTextNode(child.name));
      const sub = document.createElement("ul");
      sub.style.display = "none";
      row.addEventListener("click", () => {
        const open = sub.style.display === "none";
        sub.style.display = open ? "" : "none";
        twisty.classList.toggle("open", open);
        row.setAttribute("aria-expanded", String(open));
      });
      li.append(row, sub);
      listEl.append(li);
      renderFolder(child, sub);
    }

    const folderFiles = [...folder.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of folderFiles) {
      const li = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tree-row" + (file.path === selectedPath ? " selected" : "");
      row.title = file.path;
      row.append(document.createTextNode(file.path.split("/").pop()));
      row.addEventListener("click", () => selectFile(file.path));
      li.append(row);
      listEl.append(li);
    }
  }

  async function loadFiles(resetSelection) {
    try {
      const data = await listFiles(projectId);
      files = data.files ?? [];
      const stillThere = files.some((f) => f.path === selectedPath);
      if (resetSelection || !stillThere) {
        selectedPath = files[0]?.path ?? null;
        draft = files.find((f) => f.path === selectedPath)?.content ?? "";
        await mountEditor();
      }
      renderTree();
      updateToolbar();
      refreshPreview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load files", "error");
    }
  }

  function selectFile(path) {
    if (path === selectedPath) return;
    selectedPath = path;
    draft = files.find((f) => f.path === path)?.content ?? "";
    mountEditor();
    renderTree();
    updateToolbar();
  }

  function updateToolbar() {
    pathLabel.textContent = selectedPath ?? "No file selected";
    previewBtn.textContent = showPreview ? "Hide preview" : "Show preview";
    saveBtn.disabled = !selectedPath;
  }

  // ---- CodeMirror ----
  const onDocChanged = (update) => {
    if (update.docChanged) {
      draft = update.state.doc.toString();
      persistDraft();
      refreshPreview();
    }
  };

  // All mounts are serialized: rapid file clicks each await the language
  // module from the CDN, and two concurrent mounts would both see `view ===
  // null` and create duplicate editors.
  let mountChain = Promise.resolve();
  function mountEditor() {
    mountChain = mountChain.then(doMountEditor, doMountEditor);
    return mountChain;
  }

  async function doMountEditor() {
    editorEmpty.style.display = selectedPath ? "none" : "";
    if (!selectedPath) {
      if (view) {
        view.destroy();
        view = null;
      }
      return;
    }

    const languageExtensions = await loadLanguageFor(selectedPath);

    if (!view) {
      const state = EditorState.create({
        doc: draft,
        extensions: [
          basicSetup,
          oneDark,
          langCompartment.of(languageExtensions),
          EditorView.updateListener.of(onDocChanged),
        ],
      });
      view = new EditorView({ state, parent: cmHolder });
    } else {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: draft },
        effects: langCompartment.reconfigure(languageExtensions),
      });
    }
  }

  async function loadLanguageFor(path) {
    const key = languageKeyForPath(path);
    if (!key) return [];
    try {
      const lang = await CM_LANGUAGES[key]();
      return lang ? [lang] : [];
    } catch {
      return []; // CDN hiccup — editor still works without highlighting
    }
  }

  // ---- Preview ----
  function togglePreview() {
    showPreview = !showPreview;
    previewPane.style.display = showPreview ? "" : "none";
    if (showPreview) previewFrame.srcdoc = buildPreviewHtml(files);
    updateToolbar();
  }

  // Best-effort static preview: renders index.html if present, else the
  // first HTML file — mirrors the React canvas's behavior.
  function buildPreviewHtml(fileList) {
    const index = fileList.find((f) => /(^|\/)index\.html$/.test(f.path));
    if (index) return index.content;
    const html = fileList.find((f) => f.path.endsWith(".html"));
    if (html) return html.content;
    return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;color:#666"><p>No index.html found in this project's files yet.</p></body></html>`;
  }

  previewBtn.addEventListener("click", togglePreview);
  saveBtn.addEventListener("click", persistNow);

  loadFiles(true);

  return {
    // Called by the app shell right after a pipeline run wrote new files,
    // so the Builder's output appears without a manual refresh.
    async reload() {
      await loadFiles(false);
    },
  };
}
