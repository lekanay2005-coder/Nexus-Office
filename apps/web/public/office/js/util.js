// Small shared DOM/format helpers. Nothing framework-specific.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function formatUsd(n) {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

// Recursively find or create a node in a file-tree structure. Leaves carry
// { path, content } — exactly the shape of the /files API rows.
export function buildFileTree(files) {
  const root = { name: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      if (!node.folders.has(name)) {
        node.folders.set(name, { name, folders: new Map(), files: [], path: parts.slice(0, i + 1).join("/") });
      }
      node = node.folders.get(name);
    }
    node.files.push(file);
  }
  return root;
}

// All CodeMirror esm.sh imports must share ONE instance of
// @codemirror/state + @codemirror/view, or the editor throws
// "Unrecognized extension value". Pinning identical ?deps everywhere
// guarantees esm.sh serves a single copy of each shared package.
export const CM_DEPS =
  "@codemirror/state@6.5.2,@codemirror/view@6.36.8,@codemirror/language@6.10.8,@codemirror/commands@6.8.1,@lezer/common@1.2.3,@lezer/highlight@1.2.1,@lezer/lr@1.4.2";

export const CM_LANGUAGES = {
  js: () => import(`https://esm.sh/@codemirror/lang-javascript@6.2.2?deps=${CM_DEPS}`).then((m) => m.javascript()),
  ts: () => import(`https://esm.sh/@codemirror/lang-javascript@6.2.2?deps=${CM_DEPS}`).then((m) => m.javascript({ typescript: true, jsx: true })),
  json: () => import(`https://esm.sh/@codemirror/lang-json@6.0.1?deps=${CM_DEPS}`).then((m) => m.json()),
  css: () => import(`https://esm.sh/@codemirror/lang-css@6.3.1?deps=${CM_DEPS}`).then((m) => m.css()),
  html: () => import(`https://esm.sh/@codemirror/lang-html@6.4.9?deps=${CM_DEPS}`).then((m) => m.html()),
  md: () => import(`https://esm.sh/@codemirror/lang-markdown@6.3.2?deps=${CM_DEPS}`).then((m) => m.markdown()),
};

export function languageKeyForPath(path) {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (ext === "ts" || ext === "tsx") return "ts";
  if (ext === "js" || ext === "jsx" || ext === "mjs") return "js";
  if (["json", "css", "html", "md"].includes(ext)) return ext;
  return null;
}
