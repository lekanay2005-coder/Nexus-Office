// Deploy Desk: GitHub repo connect/save with conflict resolution, deploy
// target config, and deploy history with live status refresh. Real API.

import {
  getProject,
  patchProject,
  listGithubRepos,
  createGithubRepo,
  syncGithub,
  listDeploys,
  startDeploy,
  refreshDeploy,
  listIntegrations,
} from "./api.js";
import { showToast } from "./toast.js";
import { el } from "./util.js";

export async function renderDeployDesk(inner, projectId) {
  let project;
  try {
    ({ project } = await getProject(projectId));
  } catch (err) {
    inner.append(el("p", { class: "error-text", text: err.message }));
    return;
  }

  let hostingIntegrations = [];
  let deploys = [];
  try {
    const [{ integrations }, { deploys: deployRows }] = await Promise.all([
      listIntegrations(projectId),
      listDeploys(projectId),
    ]);
    hostingIntegrations = (integrations ?? []).filter((i) => i.type === "hosting");
    deploys = deployRows ?? [];
  } catch {
    // Deploy desk still works without integrations/deploys.
  }

  let githubRepo = project.github_repo ?? "";

  // ---------- Save to GitHub ----------
  const ghSection = el("section", {});
  ghSection.append(
    el("h2", { class: "section-title", text: "Save to GitHub" }),
    el("p", { class: "section-sub", text: "Push the project's files to a connected repo as a single commit, with automatic conflict resolution when possible." })
  );

  const ghCard = el("div", { class: "glass", style: "padding:12px;display:flex;flex-direction:column;gap:10px;" });

  const connRow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;" });
  const connLabel = el("span", { style: "font-size:13px;" });
  function paintConnection() {
    connLabel.textContent = "";
    if (githubRepo) {
      connLabel.append("Connected: ");
      connLabel.append(el("b", { text: githubRepo }));
    } else {
      connLabel.append("No repo connected");
    }
  }
  paintConnection();
  const browseBtn = el("button", { class: "btn small", text: "Connect a Repo" });
  connRow.append(connLabel, browseBtn);
  ghCard.append(connRow);

  const browsePanel = el("div", { style: "display:none;flex-direction:column;gap:8px;border-top:1px solid var(--panel-border-soft);padding-top:10px;" });
  ghCard.append(browsePanel);

  let repos = null;
  let reposLoading = false;
  const searchInput = el("input", { class: "input", placeholder: "Search your repos…" });
  const reposList = el("div", { style: "max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;" });
  const newRepoName = el("input", { class: "input", placeholder: "New repo name" });
  const privateCheck = el("input", { type: "checkbox" });
  const createBtn = el("button", { class: "btn small", text: "Create" });
  const browseStatus = el("p", { class: "error-text", style: "margin:0;" });

  browseBtn.addEventListener("click", async () => {
    const open = browsePanel.style.display === "none";
    browsePanel.style.display = open ? "flex" : "none";
    browseBtn.textContent = open ? "Close" : "Connect a Repo";
    if (open && !repos && !reposLoading) await loadRepos();
  });

  async function loadRepos() {
    reposLoading = true;
    browseStatus.textContent = "";
    reposList.textContent = "";
    reposList.append(el("p", { class: "faint", text: "Loading repos…" }));
    try {
      const data = await listGithubRepos(projectId);
      repos = data.repos ?? [];
      paintRepos();
    } catch (err) {
      repos = [];
      if (err.message === "RECONNECT_GITHUB") {
        browseStatus.style.color = "var(--warn)";
        browseStatus.textContent = "Your GitHub connection is missing or expired — reconnect via Sign in with GitHub.";
      } else {
        browseStatus.textContent = err.message;
      }
    }
    reposLoading = false;
  }

  function paintRepos() {
    reposList.textContent = "";
    const q = searchInput.value.trim().toLowerCase();
    const filtered = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(q));
    if (!filtered.length) {
      reposList.append(el("p", { class: "faint", text: "No repos match." }));
      return;
    }
    for (const repo of filtered) {
      reposList.append(el("button", {
        class: "btn small",
        style: "justify-content:flex-start;",
        text: repo.fullName + (repo.private ? " (private)" : ""),
        onclick: async () => {
          githubRepo = repo.fullName;
          await patchProject(projectId, { github_repo: githubRepo });
          paintConnection();
          browsePanel.style.display = "none";
          browseBtn.textContent = "Connect a Repo";
          showToast(`Connected to ${githubRepo}`, "success");
        },
      }));
    }
  }
  searchInput.addEventListener("input", paintRepos);

  createBtn.addEventListener("click", async () => {
    const name = newRepoName.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      const { repo } = await createGithubRepo(projectId, name, privateCheck.checked);
      githubRepo = repo.fullName;
      await patchProject(projectId, { github_repo: githubRepo });
      paintConnection();
      browsePanel.style.display = "none";
      browseBtn.textContent = "Connect a Repo";
      showToast(`Repo ${githubRepo} created and connected`, "success");
    } catch (err) {
      browseStatus.style.color = "";
      browseStatus.textContent = err.message;
    }
    createBtn.disabled = false;
  });

  browsePanel.append(searchInput, reposList, el("div", { style: "display:flex;gap:8px;align-items:center;" }, newRepoName, el("label", { class: "faint", style: "display:flex;gap:4px;align-items:center;" }, privateCheck, "Private"), createBtn), browseStatus);

  // Save button + status
  const saveGhBtn = el("button", { class: "btn primary", text: "Save to GitHub", style: "width:100%;" });
  const ghStatus = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
  ghCard.append(saveGhBtn, ghStatus);

  let resolutions = {};

  saveGhBtn.addEventListener("click", () => handleSave({}));

  async function handleSave(withResolutions) {
    saveGhBtn.disabled = true;
    saveGhBtn.textContent = "Saving…";
    ghStatus.textContent = "";
    try {
      const data = await syncGithub(projectId, withResolutions ?? {});
      if (data.status === "conflicts") {
        paintConflicts(data.conflicts ?? []);
        showToast("Both sides changed some files — pick a version for each", "info");
        return;
      }
      resolutions = {};
      ghStatus.append(el("p", { class: "ok-text", text: "Pushed ✓ " }), el("a", { href: data.url, target: "_blank", rel: "noreferrer", class: "ok-text", text: "view commit on GitHub", style: "text-decoration:underline;" }));
      showToast("Saved to GitHub", "success");
    } catch (err) {
      if (err.message === "RECONNECT_GITHUB") {
        ghStatus.append(el("p", { class: "error-text", text: "Your GitHub connection is missing or expired — reconnect via Sign in with GitHub." }));
      } else {
        ghStatus.append(el("p", { class: "error-text", text: err.message }));
      }
    }
    saveGhBtn.disabled = false;
    saveGhBtn.textContent = "Save to GitHub";
  }

  function paintConflicts(conflicts) {
    ghStatus.textContent = "";
    const box = el("div", { class: "glass", style: "padding:12px;display:flex;flex-direction:column;gap:10px;border-color:color-mix(in srgb, var(--warn) 35%, transparent);" });
    box.append(el("p", {
      class: "faint",
      style: "color:var(--warn);margin:0;",
      text: `${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed on both sides since your last sync — pick which version to keep.`,
    }));

    for (const conflict of conflicts) {
      const mineBtn = el("button", { class: "btn small", text: "Keep mine" });
      const theirsBtn = el("button", { class: "btn small", text: "Keep GitHub's" });
      const viewBtn = el("button", { class: "btn small", text: "View diff" });
      const diff = el("div", { style: "display:none;gap:8px;" });

      function paintRow() {
        const picked = resolutions[conflict.path];
        mineBtn.classList.toggle("primary", picked === "mine");
        theirsBtn.classList.toggle("primary", picked === "theirs");
      }
      mineBtn.addEventListener("click", () => { resolutions[conflict.path] = "mine"; paintRow(); updateResolveBtn(); });
      theirsBtn.addEventListener("click", () => { resolutions[conflict.path] = "theirs"; paintRow(); updateResolveBtn(); });
      viewBtn.addEventListener("click", () => {
        diff.style.display = diff.style.display === "none" ? "grid" : "none";
      });

      diff.style.gridTemplateColumns = "1fr 1fr";
      diff.append(
        el("div", {},
          el("div", { class: "faint", text: "Mine" }),
          el("pre", { class: "mono", style: "max-height:150px;overflow:auto;background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;font-size:11px;margin:4px 0 0;", text: conflict.ours })
        ),
        el("div", {},
          el("div", { class: "faint", text: "GitHub's" }),
          el("pre", { class: "mono", style: "max-height:150px;overflow:auto;background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;font-size:11px;margin:4px 0 0;", text: conflict.theirs ?? "(file deleted on GitHub)" })
        )
      );

      const row = el("div", { style: "display:flex;flex-direction:column;gap:6px;" },
        el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;" },
          el("span", { class: "mono", style: "font-size:11.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;", text: conflict.path }),
          el("div", { style: "display:flex;gap:4px;flex-shrink:0;" }, mineBtn, theirsBtn, viewBtn)
        ),
        diff
      );
      paintRow();
      box.append(row);
    }

    const resolveBtn = el("button", { class: "btn primary", text: "Resolve & Push", style: "width:100%;" });
    const updateResolveBtn = () => {
      resolveBtn.disabled = conflicts.some((c) => !resolutions[c.path]);
    };
    resolveBtn.addEventListener("click", () => handleSave(resolutions));
    resolveBtn.addEventListener("mousedown", updateResolveBtn);
    resolveBtn.disabled = conflicts.some((c) => !resolutions[c.path]);
    box.append(resolveBtn);
    ghStatus.append(box);
  }

  ghSection.append(ghCard);

  // ---------- Deploy config ----------
  const deploySection = el("section", {});
  deploySection.append(
    el("h2", { class: "section-title", text: "Deploy Desk" }),
    el("p", { class: "section-sub", text: "Push the current file tree to GitHub and track the resulting deploy. Add a GitHub/Vercel token in Settings first, or connect hosting integrations below." })
  );

  const vercelInput = el("input", { class: "input", placeholder: "prj_xxxxxxxx" });
  vercelInput.value = project.vercel_project_id ?? "";
  const targetSelect = el("select", { class: "input" },
    el("option", { value: "", text: "Vercel (via GitHub integration, default)" })
  );
  for (const h of hostingIntegrations) {
    targetSelect.append(el("option", { value: h.id, text: h.name }));
  }

  const lastSyncedLabel = el("span", { class: "faint" });
  function paintLastSynced() {
    lastSyncedLabel.textContent = project.last_synced_to_github_at
      ? `Last synced: ${new Date(project.last_synced_to_github_at).toLocaleString()}`
      : "Not synced to GitHub yet";
  }
  paintLastSynced();

  const saveSettingsBtn = el("button", { class: "btn small", text: "Save settings" });
  saveSettingsBtn.addEventListener("click", async () => {
    saveSettingsBtn.disabled = true;
    try {
      await patchProject(projectId, { vercel_project_id: vercelInput.value.trim() });
      showToast("Deploy settings saved", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
    saveSettingsBtn.disabled = false;
  });

  deploySection.append(
    el("div", { class: "glass", style: "padding:12px;display:flex;flex-direction:column;gap:9px;" },
      el("label", { class: "faint" }, "GitHub repo (owner/repo)", vercelGithubRepoInput()),
      el("label", { class: "faint" }, "Vercel project ID (optional, for live status)", vercelInput),
      el("label", { class: "faint" }, "Deploy target", targetSelect),
      el("div", { style: "display:flex;align-items:center;justify-content:space-between;" }, lastSyncedLabel, saveSettingsBtn)
    )
  );

  // Small helper so the repo input reuses the same githubRepo state.
  function vercelGithubRepoInput() {
    const input = el("input", { class: "input", placeholder: "your-org/your-repo" });
    input.value = githubRepo;
    input.addEventListener("change", async () => {
      githubRepo = input.value.trim();
      await patchProject(projectId, { github_repo: githubRepo });
      paintConnection();
      showToast("GitHub repo updated", "success");
      paintLastSynced();
    });
    return input;
  }

  const deployBtn = el("button", { class: "btn primary", text: "Deploy Now", style: "width:100%;margin-top:12px;" });
  deploySection.append(deployBtn);

  deployBtn.addEventListener("click", async () => {
    if (!githubRepo.trim()) {
      showToast("Connect a GitHub repo first", "error");
      return;
    }
    deployBtn.disabled = true;
    deployBtn.textContent = "Deploying…";
    try {
      const { deploy } = await startDeploy(projectId, targetSelect.value || undefined);
      deploys = [deploy, ...deploys];
      project.last_synced_to_github_at = new Date().toISOString();
      paintLastSynced();
      paintDeploys();
      showToast("Deploy triggered", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
    deployBtn.disabled = false;
    deployBtn.textContent = "Deploy Now";
  });

  // ---------- Deploy history ----------
  const historySection = el("section", {});
  historySection.append(el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);", text: "Deploy History" }));
  const historyList = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
  historySection.append(historyList);

  const STATUS_BADGE = {
    pending: "neutral",
    building: "warn",
    ready: "ok",
    error: "err",
  };
  const BADGE_STYLES = {
    warn: "background:color-mix(in srgb, var(--warn) 18%, transparent);color:var(--warn);",
    err: "background:color-mix(in srgb, var(--err) 18%, transparent);color:var(--err);",
  };

  function paintDeploys() {
    historyList.textContent = "";
    if (!deploys.length) {
      historyList.append(el("p", { class: "faint", text: "No deploys yet." }));
      return;
    }
    for (const d of deploys) {
      const badgeClass = STATUS_BADGE[d.status] ?? "neutral";
      const badge = el("span", { class: `badge ${badgeClass}`, text: d.status });
      if (BADGE_STYLES[badgeClass]) badge.style.cssText = BADGE_STYLES[badgeClass];

      const refreshLink = el("button", { class: "btn small", text: "Refresh" });
      refreshLink.addEventListener("click", async () => {
        try {
          const { deploy } = await refreshDeploy(projectId, d.id);
          deploys = deploys.map((x) => (x.id === d.id ? deploy : x));
          paintDeploys();
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      historyList.append(
        el("div", { class: "glass", style: "padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;" },
          el("div", { style: "min-width:0;" },
            el("div", { style: "display:flex;align-items:center;gap:7px;" },
              badge,
              d.branch ? el("span", { class: "faint mono", text: `${d.branch}@${(d.github_commit_sha ?? "").slice(0, 7)}` }) : null,
              d.hosting_integration_id ? el("span", { class: "faint", text: "check your host's dashboard" }) : null
            ),
            el("div", { class: "faint", text: new Date(d.created_at).toLocaleString() })
          ),
          el("div", { style: "display:flex;gap:8px;flex-shrink:0;align-items:center;" },
            d.deployment_url ? el("a", { href: d.deployment_url, target: "_blank", rel: "noreferrer", class: "ok-text", text: "View" }) : null,
            d.status === "building" || d.status === "pending" ? refreshLink : null
          )
        )
      );
    }
  }
  paintDeploys();

  // Poll while any deploy is in flight (real status refresh, 4s).
  setInterval(async () => {
    const inFlight = deploys.filter((d) => d.status === "building" || d.status === "pending");
    if (!inFlight.length) return;
    for (const d of inFlight) {
      try {
        const { deploy } = await refreshDeploy(projectId, d.id);
        deploys = deploys.map((x) => (x.id === d.id ? deploy : x));
      } catch {
        // keep polling; transient refresh errors are fine
      }
    }
    paintDeploys();
  }, 4000);

  inner.append(ghSection, deploySection, historySection);
}
