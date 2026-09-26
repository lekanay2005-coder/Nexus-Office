// Nexus Office — app shell & router (hash-based). Wires auth, the project
// picker, and the split-pane Office workspace (Chat | Code) plus the
// Deploy, Memory, Cost and Settings pages.

import { initAuth, getSupabase, renderAuthView } from "./auth.js";
import { listProjects, getProject, getMemory } from "./api.js";
import { createChatPane } from "./chat.js";
import { createCodeCanvas } from "./canvas.js";
import {
  renderModelRouter,
  renderApiKeys,
  renderIntegrations,
  renderMemory,
  renderCost,
} from "./settings.js";
import { renderAudit } from "./audit.js";
import { renderPermissions } from "./permissions.js";
import { renderDeployDesk } from "./deploy.js";
import { showToast } from "./toast.js";
import { debounce } from "./util.js";

const root = document.getElementById("app");
const topbar = document.querySelector(".topbar");

// One debounced resize listener for the whole app; the active workspace
// registers a handler, stale ones are ignored via the projectId guard.
let viewportHandler = null;
const handleViewportChange = debounce(() => viewportHandler?.(), 120);
window.addEventListener("resize", handleViewportChange);

// ---------- Bootstrap ----------
async function boot() {
  let session;
  try {
    session = await initAuth();
  } catch (err) {
    if (err && err.status === 503) {
      renderSetupCard();
    } else {
      renderBootError("Could not reach the Nexus Office API. Is the app running?");
    }
    return;
  }

  if (!session) {
    renderAuthView(root, () => boot());
    return;
  }

  // OAuth returns: supabase-js detects the ?code= in the URL during
  // initAuth, so the session is already established — just clean the URL.
  if (window.location.search.includes("code=")) {
    history.replaceState(null, "", window.location.pathname);
  }

  window.addEventListener("hashchange", () => safeRender(route));
  await safeRender(route);
}

function renderBootError(message) {
  root.textContent = "";
  const view = document.createElement("div");
  view.className = "auth-view";
  const card = document.createElement("div");
  card.className = "glass auth-card";
  card.textContent = message;
  view.append(card);
  root.append(view);
}

// Shown when the server reports (via /api/config → 503) that Supabase env
// vars aren't set yet — guides the user through fixing it and reloads.
function renderSetupCard() {
  root.textContent = "";
  const view = document.createElement("div");
  view.className = "auth-view";

  const card = document.createElement("div");
  card.className = "glass auth-card";

  const h1 = document.createElement("h1");
  h1.textContent = "Setup required";
  const sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "The server is running, but its Supabase connection isn't configured yet.";

  const list = document.createElement("ol");
  list.style.cssText = "margin:0 0 14px;padding-left:20px;font-size:13px;line-height:2;color:var(--text-soft,#b7bdc9);";
  for (const step of [
    "Create a project at supabase.com (Settings → API for the URL + anon key).",
    "Run every migration in supabase/migrations/ against it.",
    "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings → Environment.",
  ]) {
    const li = document.createElement("li");
    li.textContent = step;
    list.append(li);
  }

  const hint = document.createElement("p");
  hint.className = "section-sub";
  hint.style.fontSize = "12px";
  hint.textContent = "Also add NEXUS_ENCRYPTION_KEY and a provider key (e.g. ANTHROPIC_API_KEY) before running the pipeline.";

  const reload = document.createElement("button");
  reload.className = "btn primary";
  reload.textContent = "I've added them — reload";
  reload.addEventListener("click", () => location.reload());

  card.append(h1, sub, list, hint, reload);
  view.append(card);
  root.append(view);
}

// ---------- Top bar ----------
function clearTopbar() {
  topbar.querySelectorAll("[data-dynamic]").forEach((n) => n.remove());
}

function addTopbarRight(children) {
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  spacer.dataset.dynamic = "";
  topbar.append(spacer, ...children);
}

function addTopbarLeft(children) {
  // Left-cluster items sit right after the brand link.
  const brand = topbar.querySelector(".brand");
  let anchor = brand;
  for (const child of children) {
    anchor.after(child);
    anchor = child;
  }
}

// ---------- Project picker ----------
let projectsCache = null;

async function renderProjectsView() {
  clearTopbar();
  root.textContent = "";
  const view = document.createElement("div");
  view.className = "page-view";
  view.style.paddingTop = "calc(var(--topbar-h) + 22px)";
  const inner = document.createElement("div");
  inner.className = "page-inner";
  view.append(inner);
  root.append(view);

  const h1 = document.createElement("h1");
  h1.textContent = "Your Projects";
  h1.style.cssText = "margin:0 0 4px;font-size:22px;";
  const sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "Open a project to enter the Office.";
  inner.append(h1, sub);

  const form = document.createElement("form");
  form.style.cssText = "display:flex;gap:8px;margin-bottom:20px;";
  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.placeholder = "New project name…";
  nameInput.setAttribute("aria-label", "New project name");
  const createBtn = document.createElement("button");
  createBtn.type = "submit";
  createBtn.className = "btn primary";
  createBtn.textContent = "Create";
  form.append(nameInput, createBtn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create project");
      projectsCache = null;
      nameInput.value = "";
      showToast(`Project "${name}" created`, "success");
      location.hash = `#/project/${data.project.id}`;
    } catch (err) {
      showToast(err.message, "error");
    }
    createBtn.disabled = false;
  });
  inner.append(form);

  if (!projectsCache) {
    const { projects } = await listProjects();
    projectsCache = projects ?? [];
  }

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  if (!projectsCache.length) {
    const none = document.createElement("p");
    none.className = "faint";
    none.textContent = "No projects yet. Create one above to open the Office.";
    list.append(none);
  }
  for (const project of projectsCache) {
    const link = document.createElement("a");
    link.href = `#/project/${project.id}`;
    link.className = "glass item-card";
    link.textContent = project.name;
    link.style.cssText = "text-decoration:none;color:inherit;";
    list.append(link);
  }
  inner.append(list);
}

// ---------- Office workspace ----------
// The workspace (chat + canvas instances) stays alive while navigating
// between its pages; only the right pane re-renders.
let workspace = null;

async function renderWorkspace(projectId) {
  let project, memory;
  try {
    [{ project }, { memory }] = await Promise.all([getProject(projectId), getMemory(projectId)]);
  } catch {
    location.hash = "#/projects";
    return;
  }

  clearTopbar();

  const name = document.createElement("span");
  name.className = "project-name";
  name.dataset.dynamic = "";
  name.textContent = project.name;

  const tags = document.createElement("div");
  tags.className = "tech-tags";
  tags.dataset.dynamic = "";
  for (const tech of (memory?.tech_stack ?? []).slice(0, 4)) {
    const tag = document.createElement("span");
    tag.className = "tech-tag";
    tag.textContent = tech;
    tags.append(tag);
  }

  const deployBtn = document.createElement("button");
  deployBtn.className = "btn small role-accent";
  deployBtn.style.setProperty("--btn-accent", "var(--role-ops)");
  deployBtn.dataset.dynamic = "";
  deployBtn.textContent = "Deploy";
  deployBtn.addEventListener("click", () => {
    location.hash = `#/project/${projectId}/desk`;
  });

  // Highlight the top-bar button that matches the current right-pane page.
  function paintTopbarActive(page) {
    deployBtn.style.opacity = page === "desk" ? "1" : "0.55";
    gear.style.opacity = page === "settings" ? "1" : "0.55";
  }

  const gear = document.createElement("button");
  gear.className = "btn small";
  gear.dataset.dynamic = "";
  gear.setAttribute("aria-label", "Settings");
  gear.title = "Settings";
  gear.textContent = "⚙";
  gear.addEventListener("click", () => {
    location.hash = `#/project/${projectId}/settings`;
  });

  const signOut = document.createElement("button");
  signOut.className = "btn small";
  signOut.dataset.dynamic = "";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", async () => {
    await getSupabase().auth.signOut();
    location.hash = "";
    location.reload();
  });

  addTopbarLeft([name, tags]);
  addTopbarRight([deployBtn, gear, signOut]);

  // Shell
  root.textContent = "";
  const shell = document.createElement("div");
  shell.className = "shell";
  root.append(shell);

  const paneLeft = document.createElement("div");
  paneLeft.className = "pane pane-left";
  const divider = document.createElement("div");
  divider.className = "divider";
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.tabIndex = 0;
  divider.setAttribute("aria-label", "Resize panels (left and right arrow keys)");
  const paneRight = document.createElement("div");
  paneRight.className = "pane pane-right";
  shell.append(paneLeft, divider, paneRight);

  // Chat pane lives for the whole workspace session.
  const chat = createChatPane(paneLeft, {
    onFilesWritten: () => {
      if (workspace?.projectId === projectId && workspace.currentPage === "code") {
        workspace.canvas?.reload();
      }
      showToast("Builder wrote files to the Code Canvas", "info");
    },
  });
  chat.setActiveProject(projectId);

  // Mobile tab switcher (hidden on desktop via CSS).
  const TABS = [
    ["chat", "Chat"],
    ["code", "Code"],
    ["desk", "Deploy"],
    ["memory", "Memory"],
    ["cost", "Cost"],
    ["audit", "Audit"],
    ["permissions", "Permissions"],
    ["settings", "Settings"],
  ];
  const tabs = document.createElement("nav");
  tabs.className = "work-tabs";
  const tabButtons = new Map();
  for (const [tab, label] of TABS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      location.hash = tab === "chat" ? `#/project/${projectId}` : `#/project/${projectId}/${tab}`;
    });
    tabButtons.set(tab, btn);
    tabs.append(btn);
  }
  root.insertBefore(tabs, shell);

  function paintMobileTabs(active) {
    for (const [tab, btn] of tabButtons) btn.classList.toggle("active", tab === active);
  }

  // Right-pane page renderer: code | desk | memory | cost | settings.
  let currentPage = null;

  async function renderPage(page) {
    const isDesktop = window.innerWidth >= 768;
    const samePage = currentPage === page;
    currentPage = page;
    paintTopbarActive(page);
    paintMobileTabs(page);

    if (samePage && page === "code") {
      // Viewport may have crossed the desktop/mobile boundary — repaint the
      // responsive classes, but never rebuild the Code Canvas itself.
      paneRight.classList.toggle("mobile-active", !isDesktop);
      paneLeft.classList.remove("mobile-active");
      return;
    }

    paneRight.classList.toggle("mobile-active", !isDesktop);
    paneLeft.classList.toggle("mobile-active", !isDesktop && page === "chat");
    // On desktop, non-chat pages replace the Code pane in the split view;
    // on mobile they take over the right pane like the Code tab does.
    if (page !== "code" && page !== "chat") {
      paneLeft.classList.remove("mobile-active");
    }

    paneRight.textContent = "";
    if (page === "code") {
      createCodeCanvas(paneRight, { projectId });
      return;
    }
    const pageView = document.createElement("div");
    pageView.className = "page-view";
    pageView.style.padding = "18px";
    const inner = document.createElement("div");
    inner.className = "page-inner";
    pageView.append(inner);
    paneRight.append(pageView);
    if (page === "desk") await renderDeployDesk(inner, projectId);
    if (page === "memory") await renderMemory(inner, projectId);
    if (page === "cost") await renderCost(inner, projectId);
    if (page === "audit") await renderAudit(inner, projectId);
    if (page === "permissions") await renderPermissions(inner, projectId);
    if (page === "settings") await renderSettingsPage(inner, projectId);
  }

  workspace = {
    projectId,
    get currentPage() {
      return currentPage;
   },
    chat,
    renderPage,
  };

  const page = pageFromHash(projectId);
  if (page === "chat" && window.innerWidth < 768) {
    await renderPage("chat");
  } else {
    await renderPage(page === "chat" ? "code" : page);
  }

  // ---------- Split-pane drag (plain mouse events, no library) ----------
  function setPaneWidth(pct) {
    paneLeft.style.width = `${Math.min(75, Math.max(25, pct))}%`;
  }
  function currentPct() {
    return (paneLeft.getBoundingClientRect().width / shell.getBoundingClientRect().width) * 100;
  }

  let dragging = false;
  divider.addEventListener("mousedown", (e) => {
    dragging = true;
    divider.classList.add("dragging");
    document.body.classList.add("dragging");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const shellRect = shell.getBoundingClientRect();
    setPaneWidth(((e.clientX - shellRect.left) / shellRect.width) * 100);
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("dragging");
    document.body.classList.remove("dragging");
  });
  // Keyboard resize: arrows move by 2% (10% with Shift).
  divider.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPaneWidth(currentPct() - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPaneWidth(currentPct() + step);
    }
  });

  // Repaint panes when the viewport crosses the 768px desktop/mobile boundary.
  let wasDesktop = window.innerWidth >= 768;
  viewportHandler = () => {
    const isDesktop = window.innerWidth >= 768;
    if (isDesktop === wasDesktop || workspace?.projectId !== projectId) return;
    wasDesktop = isDesktop;
    if (currentPage === "chat" && isDesktop) return; // chat is always visible on desktop
    renderPage(currentPage === "chat" ? "code" : (currentPage ?? "code"));
  };
}

function pageFromHash(projectId) {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "project" && parts[1] === projectId && parts[2]) return parts[2];
  return "chat";
}

// Re-render only the right pane when the hash page changes within the same
// project, instead of rebuilding the whole workspace.
async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  if (!parts.length || parts[0] === "projects") {
    workspace = null;
    await renderProjectsView();
    return;
  }

  if (parts[0] === "project" && parts[1]) {
    const projectId = parts[1];
    const page = parts[2] ?? "chat";

    if (workspace && workspace.projectId === projectId) {
      const isDesktop = window.innerWidth >= 768;
      if (page === "chat") {
        if (isDesktop) return; // chat is always visible in the split view
        await workspace.renderPage("chat");
      } else {
        await workspace.renderPage(page);
      }
      return;
    }
    await renderWorkspace(projectId);
    return;
  }

  location.hash = "#/projects";
}

// ---------- Settings page (Model Router + Keys + Integrations + governance) ----------
async function renderSettingsPage(inner, projectId) {
  const sections = document.createElement("div");
  sections.style.cssText = "display:flex;flex-direction:column;gap:34px;";
  inner.append(sections);

  // Governance quick links (Addendum 3).
  const gov = document.createElement("section");
  gov.className = "glass";
  gov.style.cssText = "padding:16px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;";
  const govLabel = document.createElement("span");
  govLabel.className = "section-title";
  govLabel.style.cssText = "margin:0;font-size:14px;";
  govLabel.textContent = "Governance";
  const auditLink = document.createElement("a");
  auditLink.className = "btn small";
  auditLink.href = `#/project/${projectId}/audit`;
  auditLink.textContent = "Audit log";
  const permsLink = document.createElement("a");
  permsLink.className = "btn small";
  permsLink.href = `#/project/${projectId}/permissions`;
  permsLink.textContent = "Role permissions & approvals";
  gov.append(govLabel, auditLink, permsLink);
  sections.append(gov);

  const routerSection = document.createElement("section");
  const keysSection = document.createElement("section");
  const integrationsSection = document.createElement("section");
  sections.append(routerSection, keysSection, integrationsSection);

  await renderModelRouter(routerSection, projectId);
  await renderApiKeys(keysSection);
  await renderIntegrations(integrationsSection, projectId);
}

async function safeRender(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showToast(err instanceof Error ? err.message : "Something went wrong", "error");
  }
}

boot();
