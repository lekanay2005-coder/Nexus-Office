// Role permissions (Addendum 3): least-privilege capability toggles per
// role, enforced server-side, plus the per-project "Require approval for
// production actions" setting. Defaults match the server's built-ins.

import { el } from "./util.js";
import { ROLE_COLORS, ROLE_LABELS, ROLE_GLYPHS } from "./roles.js";
import { listCapabilities, putCapabilities, getProjectSettings, patchProjectSettings } from "./api.js";
import { showToast } from "./toast.js";

const CAPABILITIES = [
  ["read_files", "Read files"],
  ["write_files", "Write files"],
  ["read_project_memory", "Read memory"],
  ["write_project_memory", "Write memory"],
  ["trigger_deploy", "Trigger deploy"],
  ["trigger_github_commit", "GitHub commit"],
];

const DEFAULTS = {
  strategist: ["read_project_memory", "read_files"],
  builder: ["write_files", "read_project_memory"],
  analyst: ["read_files", "read_project_memory"],
  qa: ["read_files", "read_project_memory"],
  ops: ["write_project_memory", "trigger_deploy", "trigger_github_commit"],
};

export async function renderPermissions(inner, projectId) {
  inner.append(
    el("div", {},
      el("h2", { class: "section-title", text: "Role Permissions" }),
      el("p", { class: "section-sub", text: "Least-privilege controls: what each role is allowed to do in this project. Enforced server-side before any role output is applied." })
    )
  );

  let capabilities, settings;
  try {
    [{ capabilities }, { settings }] = await Promise.all([
      listCapabilities(projectId),
      getProjectSettings(projectId),
    ]);
  } catch (err) {
    inner.append(el("p", { class: "error-text", text: err.message }));
    return;
  }

  // ---- Approval gating ----
  const approvalToggle = el("input", { type: "checkbox", class: "toggle" });
  approvalToggle.checked = settings?.requireApproval !== false;
  approvalToggle.addEventListener("change", async () => {
    approvalToggle.disabled = true;
    try {
      await patchProjectSettings(projectId, { requireApproval: approvalToggle.checked });
      showToast(
        approvalToggle.checked
          ? "Approval required for production actions"
          : "Full autonomy — production actions run without approval",
        "success"
      );
    } catch (err) {
      approvalToggle.checked = !approvalToggle.checked;
      showToast(err.message, "error");
    }
    approvalToggle.disabled = false;
  });

  inner.append(
    el("div", { class: "glass approval-card" },
      el("div", { class: "approval-row" },
        el("div", {},
          el("div", { class: "approval-title", text: "Require approval for production actions" }),
          el("p", { class: "section-sub", text: "GitHub commits, production deploys, and integration deletion ask for explicit approval first. Every approval or rejection lands in the Audit Log." })
        ),
        el("label", { class: "toggle-wrap", "aria-label": "Require approval for production actions" }, approvalToggle)
      )
    )
  );

  // ---- Capability grid ----
  inner.append(el("h3", { class: "section-title", style: "font-size:15px;margin-top:26px;", text: "Capabilities per role" }));

  const grid = el("div", { class: "cap-grid" });
  const checkboxes = new Map(); // `${role}:${capability}` → checkbox

  for (const role of Object.keys(ROLE_LABELS)) {
    const granted = new Set(capabilities[role] ?? DEFAULTS[role] ?? []);
    const card = el("div", { class: "glass cap-card", style: `--role-color:${ROLE_COLORS[role]}` });
    card.append(
      el("div", { class: "cap-role" },
        el("span", { class: "role-dot", html: ROLE_GLYPHS[role], style: `--role-color:${ROLE_COLORS[role]}` }),
        el("span", { text: ROLE_LABELS[role] })
      )
    );
    for (const [capability, label] of CAPABILITIES) {
      const box = el("input", { type: "checkbox", class: "toggle" });
      box.checked = granted.has(capability);
      checkboxes.set(`${role}:${capability}`, box);
      card.append(
        el("label", { class: "cap-row" },
          box,
          el("span", { text: label })
        )
      );
    }
    grid.append(card);
  }
  inner.append(grid);

  const saveBtn = el("button", {
    class: "btn primary",
    text: "Save permissions",
    onclick: save,
  });
  const resetBtn = el("button", {
    class: "btn",
    text: "Reset to defaults",
    onclick: () => {
      for (const [key, box] of checkboxes) {
        const [role, capability] = key.split(":");
        box.checked = (DEFAULTS[role] ?? []).includes(capability);
      }
      showToast("Defaults loaded — press Save to apply", "info");
    },
  });

  inner.append(el("div", { class: "cap-actions" }, resetBtn, saveBtn));

  async function save() {
    saveBtn.disabled = true;
    const desired = {};
    for (const role of Object.keys(ROLE_LABELS)) {
      desired[role] = [];
      for (const [capability] of CAPABILITIES) {
        if (checkboxes.get(`${role}:${capability}`)?.checked) desired[role].push(capability);
      }
    }
    try {
      await putCapabilities(projectId, desired);
      showToast("Permissions saved", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
    saveBtn.disabled = false;
  }
}
