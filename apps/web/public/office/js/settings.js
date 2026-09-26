// Settings pages: Model Router, API Keys, Integrations (card grid with
// Test Connection), Memory Board, and Cost Meter. All real-API-backed.

import {
  ROLES,
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_GLYPHS,
  MODEL_CATALOG,
  PROVIDER_LABELS,
  DEFAULT_PROVIDER_CONFIG,
  estimateCostUsd,
  roleDot,
} from "./roles.js";
import {
  listRoleModels,
  putRoleModel,
  listApiKeys,
  putApiKey,
  deleteApiKey,
  listIntegrations,
  saveIntegration,
  deleteIntegration,
  testIntegration,
  getMemory,
  patchMemory,
  getCost,
} from "./api.js";
import { showToast } from "./toast.js";
import { runWithApproval } from "./confirm.js";
import { el } from "./util.js";

const BUILT_INS = ["anthropic", "openai", "google"];

// ---------- Model Router ----------
export async function renderModelRouter(inner, projectId) {
  inner.append(
    el("div", {},
      el("h2", { class: "section-title", text: "Model Router" }),
      el("p", { class: "section-sub", text: "Choose which provider and model handles each role in the pipeline." })
    )
  );

  let assignments = {};
  let customNames = [];
  try {
    const [{ roleModels }, { integrations }] = await Promise.all([
      listRoleModels(projectId),
      listIntegrations(projectId),
    ]);
    const byRole = new Map((roleModels ?? []).map((r) => [r.role, r]));
    for (const role of ROLES) {
      const existing = byRole.get(role);
      assignments[role] = {
        role,
        provider: existing?.provider ?? DEFAULT_PROVIDER_CONFIG.provider,
        model: existing?.model ?? DEFAULT_PROVIDER_CONFIG.model,
      };
    }
    customNames = (integrations ?? []).filter((i) => i.type === "ai_provider").map((i) => i.name);
  } catch (err) {
    inner.append(el("p", { class: "error-text", text: err.message }));
    return;
  }

  const list = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });

  for (const role of ROLES) {
    const row = el("div", { class: "role-row", style: `--role-color:${ROLE_COLORS[role]}` });
    row.append(el("span", { class: "role-dot", html: ROLE_GLYPHS[role], style: `--role-color:${ROLE_COLORS[role]}` }));
    row.append(el("span", { class: "role-label", text: ROLE_LABELS[role] }));

    const providerSelect = el("select", { class: "input", "aria-label": `${ROLE_LABELS[role]} provider` });
    const builtInGroup = el("optgroup", { label: "Built-in" });
    for (const p of BUILT_INS) builtInGroup.append(el("option", { value: p, text: PROVIDER_LABELS[p] }));
    providerSelect.append(builtInGroup);
    if (customNames.length) {
      const customGroup = el("optgroup", { label: "Integrations" });
      for (const name of customNames) customGroup.append(el("option", { value: name, text: name }));
      providerSelect.append(customGroup);
    }

    const modelSlot = el("div", { class: "model-slot" });
    const saveBadge = el("span", { class: "faint", style: "width:52px;text-align:right;", text: "" });

    async function saveAssignment() {
      saveBadge.textContent = "Saving…";
      try {
        await putRoleModel(projectId, {
          role,
          provider: providerSelect.value,
          model: assignments[role].model,
        });
        assignments[role].provider = providerSelect.value;
        saveBadge.textContent = "Saved ✓";
        setTimeout(() => (saveBadge.textContent = ""), 1500);
      } catch (err) {
        saveBadge.textContent = "";
        showToast(err.message, "error");
      }
    }

    providerSelect.value = assignments[role].provider;
    providerSelect.addEventListener("change", async () => {
      const provider = providerSelect.value;
      const firstModel = MODEL_CATALOG.find((m) => m.provider === provider)?.model;
      if (firstModel && BUILT_INS.includes(provider)) {
        assignments[role].model = firstModel;
      }
      renderModelSlot();
      await saveAssignment();
    });

    function renderModelSlot() {
      modelSlot.textContent = "";
      const provider = assignments[role].provider;
      if (BUILT_INS.includes(provider)) {
        const modelSelect = el("select", { class: "input", "aria-label": `${ROLE_LABELS[role]} model` });
        for (const m of MODEL_CATALOG.filter((m) => m.provider === provider)) {
          modelSelect.append(el("option", { value: m.model, text: m.label }));
        }
        if (!MODEL_CATALOG.some((m) => m.provider === provider && m.model === assignments[role].model)) {
          modelSelect.append(el("option", { value: assignments[role].model, text: assignments[role].model }));
        }
        modelSelect.value = assignments[role].model;
        modelSelect.addEventListener("change", () => {
          assignments[role].model = modelSelect.value;
          saveAssignment();
        });
        modelSlot.append(modelSelect);
      } else {
        const modelInput = el("input", {
          class: "input",
          value: assignments[role].model,
          placeholder: "Model name for this integration",
          "aria-label": `${ROLE_LABELS[role]} model`,
        });
        modelInput.addEventListener("change", () => {
          assignments[role].model = modelInput.value.trim() || assignments[role].model;
          saveAssignment();
        });
        modelSlot.append(modelInput);
      }
    }

    renderModelSlot();
    row.append(providerSelect, modelSlot, saveBadge);
    list.append(row);
  }

  inner.append(list);
}

// ---------- API Keys ----------
export async function renderApiKeys(inner) {
  inner.append(
    el("div", {},
      el("h2", { class: "section-title", text: "API Keys" }),
      el("p", {
        class: "section-sub",
        text: "Your keys are encrypted at rest and only used to call that provider on your behalf. Leave a provider unconfigured to fall back to the app's default key.",
      })
    )
  );

  let configured = new Set();
  try {
    const { apiKeys } = await listApiKeys();
    configured = new Set((apiKeys ?? []).map((k) => k.provider));
  } catch (err) {
    inner.append(el("p", { class: "error-text", text: err.message }));
    return;
  }

  const grid = el("div", { class: "card-grid" });

  for (const provider of BUILT_INS) {
    const card = el("div", { class: "glass item-card" });
    const body = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
    card.append(
      el("div", { class: "card-top" },
        el("span", { class: "item-name", text: PROVIDER_LABELS[provider] }),
        configured.has(provider) ? el("span", { class: "badge ok", text: "Key saved" }) : el("span", { class: "badge neutral", text: "Not set" })
      ),
      body
    );

    function paint() {
      body.textContent = "";
      if (configured.has(provider)) {
        // Masked display — the API never returns the key itself.
        body.append(
          el("div", { class: "key-masked", text: "••••••••••••" }),
          el("button", {
            class: "btn small danger",
            text: "Remove key",
            onclick: async () => {
              try {
                await deleteApiKey(provider);
                configured.delete(provider);
                paint();
                showToast(`${PROVIDER_LABELS[provider]} key removed`, "success");
              } catch (err) {
                showToast(err.message, "error");
              }
            },
          })
        );
      } else {
        const keyInput = el("input", {
          class: "input",
          type: "password",
          placeholder: `${PROVIDER_LABELS[provider]} API key`,
          "aria-label": `${PROVIDER_LABELS[provider]} API key`,
        });
        const saveBtn = el("button", { class: "btn small primary", text: "Save key" });
        saveBtn.addEventListener("click", async () => {
          const key = keyInput.value.trim();
          if (!key) return;
          saveBtn.disabled = true;
          try {
            await putApiKey(provider, key);
            configured.add(provider);
            paint();
            showToast(`${PROVIDER_LABELS[provider]} key saved`, "success");
          } catch (err) {
            showToast(err.message, "error");
          }
          saveBtn.disabled = false;
        });
        keyInput.addEventListener("keydown", (e) => e.key === "Enter" && saveBtn.click());
        body.append(keyInput, saveBtn);
      }
    }

    paint();
    grid.append(card);
  }

  inner.append(grid);
}

// ---------- Integrations ----------
export async function renderIntegrations(inner, projectId) {
  const head = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;" });
  head.append(
    el("div", {},
      el("h2", { class: "section-title", text: "Integrations" }),
      el("p", {
        class: "section-sub",
        text: "Add any AI provider or hosting service by name and base URL. AI providers appear in the Model Router; hosting integrations appear in Deploy Desk.",
      })
    )
  );
  const addBtn = el("button", { class: "btn small role-accent", text: "+ Add Integration" });
  addBtn.style.setProperty("--btn-accent", "var(--role-strategist)");
  head.append(addBtn);
  inner.append(head);

  let integrations = [];
  try {
    ({ integrations } = await listIntegrations(projectId));
  } catch (err) {
    inner.append(el("p", { class: "error-text", text: err.message }));
    integrations = [];
  }
  integrations = integrations ?? [];

  const grid = el("div", { class: "card-grid" });
  inner.append(grid);

  let formOpen = false;
  let formEl = null;
  addBtn.addEventListener("click", () => {
    formOpen = !formOpen;
    if (formOpen && !formEl) {
      formEl = buildAddForm();
      inner.insertBefore(formEl, grid);
    } else if (formEl) {
      formEl.remove();
      formEl = null;
    }
    addBtn.textContent = formOpen ? "Cancel" : "+ Add Integration";
  });

  const PRESETS = [
    { label: "OpenRouter", url: "https://openrouter.ai/api/v1", type: "ai_provider" },
    { label: "Together AI", url: "https://api.together.xyz/v1", type: "ai_provider" },
    { label: "OpenAI", url: "https://api.openai.com/v1", type: "ai_provider" },
    { label: "Anthropic", url: "https://api.anthropic.com/v1", type: "ai_provider" },
  ];

  function buildAddForm() {
    const typeSelect = el("select", { class: "input" },
      el("option", { value: "ai_provider", text: "AI Provider" }),
      el("option", { value: "hosting", text: "Hosting" })
    );
    const nameInput = el("input", { class: "input", placeholder: 'Name (e.g. "OpenRouter" or "Netlify")' });
    const urlInput = el("input", { class: "input", placeholder: "Base URL (e.g. https://openrouter.ai/api/v1)" });
    const keyInput = el("input", { class: "input", type: "password", placeholder: "API key" });
    const errText = el("p", { class: "error-text", style: "margin:0;" });

    const presetRow = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;" });
    function paintPresets() {
      presetRow.textContent = "";
      for (const p of PRESETS.filter((p) => p.type === typeSelect.value)) {
        presetRow.append(el("button", {
          class: "btn small",
          type: "button",
          text: p.label,
          onclick: () => {
            urlInput.value = p.url;
            if (!nameInput.value) nameInput.value = p.label;
          },
        }));
      }
    }
    paintPresets();
    typeSelect.addEventListener("change", () => {
      paintPresets();
      urlInput.placeholder = typeSelect.value === "hosting"
        ? "Deploy hook URL (e.g. https://api.netlify.com/build_hooks/xxxx)"
        : "Base URL (e.g. https://openrouter.ai/api/v1)";
    });

    const form = el("form", { class: "glass", style: "display:flex;flex-direction:column;gap:8px;padding:14px;" },
      el("div", { style: "display:flex;gap:8px;" }, typeSelect, nameInput),
      presetRow,
      urlInput,
      keyInput,
      errText
    );
    const submitBtn = el("button", { class: "btn primary", type: "submit", text: "Save Integration" });
    form.append(submitBtn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errText.textContent = "";
      const name = nameInput.value.trim();
      const apiKey = keyInput.value.trim();
      if (!name) return;
      if (typeSelect.value === "ai_provider" && !apiKey) {
        errText.textContent = "api_key is required for AI providers.";
        return;
      }
      submitBtn.disabled = true;
      try {
        const { integration } = await saveIntegration(projectId, {
          type: typeSelect.value,
          name,
          base_url: urlInput.value.trim(),
          api_key: apiKey,
          extra_config: {},
        });
        integrations = [...integrations.filter((i) => i.name !== integration.name), integration];
        paintGrid();
        form.remove();
        formEl = null;
        formOpen = false;
        addBtn.textContent = "+ Add Integration";
        showToast(`Integration "${integration.name}" saved`, "success");
      } catch (err) {
        errText.textContent = err.message;
      }
      submitBtn.disabled = false;
    });
    return form;
  }

  function paintGrid() {
    grid.textContent = "";
    if (!integrations.length) {
      grid.append(el("p", { class: "faint", text: "No integrations added yet." }));
      return;
    }
    for (const integration of integrations) {
      const card = el("div", { class: "glass item-card" });
      const testRow = el("div", { class: "test-row" });
      card.append(
        el("div", { class: "card-top" },
          el("span", { class: "item-name", text: integration.name }),
          el("span", { class: "badge neutral", text: integration.type === "ai_provider" ? "AI" : "Hosting" })
        ),
        el("div", { class: "item-sub", text: integration.base_url ?? "no base URL" }),
        testRow
      );

      const testBtn = el("button", { class: "btn small", text: "Test Connection" });
      testRow.append(testBtn);

      testBtn.addEventListener("click", async () => {
        // Inline spinner while the real fetch runs, then flip to ✓ / ✗.
        testBtn.disabled = true;
        testRow.textContent = "";
        testRow.append(el("span", { class: "spinner" }), el("span", { class: "faint", text: "Testing…" }));
        try {
          const result = await testIntegration(projectId, integration.id);
          testRow.textContent = "";
          testRow.append(testBtn);
          testRow.append(el("span", { class: `test-result ${result.ok ? "ok" : "err"}`, text: result.message }));
        } catch (err) {
          testRow.textContent = "";
          testRow.append(testBtn);
          testRow.append(el("span", { class: "test-result err", text: err.message }));
        }
      });

      const deleteBtn = el("button", {
        class: "btn small danger",
        text: "Delete",
        onclick: async () => {
          deleteBtn.disabled = true;
          try {
            // Approval-gated: server returns 409 + summary when the project
            // requires approval; modal confirms before the delete retries.
            const result = await runWithApproval(projectId, (confirmed) =>
              deleteIntegration(projectId, integration.id, confirmed)
            );
            if (result === null) {
              showToast("Deletion cancelled", "info");
              return;
            }
            integrations = integrations.filter((i) => i.id !== integration.id);
            paintGrid();
            showToast(`Integration "${integration.name}" deleted`, "success");
          } catch (err) {
            showToast(err.message, "error");
          }
          deleteBtn.disabled = false;
        },
      });
      card.append(el("div", { style: "display:flex;gap:6px;margin-top:2px;" }, testRow));

      const topRow = card.querySelector(".card-top");
      topRow.append(deleteBtn);
      grid.append(card);
    }
  }

  paintGrid();
}

// ---------- Memory Board ----------
export async function renderMemory(inner, projectId) {
  inner.append(
    el("div", {},
      el("h2", { class: "section-title", text: "Memory Board" }),
      el("p", { class: "section-sub", text: "The project's persistent memory — auto-appended by Ops after each run, editable by you." })
    )
  );

  let memory = null;
  try {
    ({ memory } = await getMemory(projectId));
  } catch (err) {
    inner.append(el("p", { class: "error-text", text: err.message }));
    return;
  }

  memory = memory ?? { tech_stack: [], decisions: [], open_issues: [], summary: "" };

  async function patch(body) {
    try {
      const { memory: updated } = await patchMemory(projectId, body);
      if (updated) memory = updated;
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  // Summary
  const summaryArea = el("textarea", {
    class: "input",
    rows: "3",
    placeholder: "Free-text rolling summary of the project, fed to every role.",
  });
  summaryArea.value = memory.summary ?? "";
  const saveSummaryBtn = el("button", { class: "btn small", text: "Save summary" });
  saveSummaryBtn.addEventListener("click", async () => {
    saveSummaryBtn.disabled = true;
    await patch({ summary: summaryArea.value });
    saveSummaryBtn.textContent = "Saved ✓";
    setTimeout(() => {
      saveSummaryBtn.textContent = "Save summary";
      saveSummaryBtn.disabled = false;
    }, 1500);
  });
  inner.append(
    el("section", {},
      el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);", text: "Summary" }),
      summaryArea,
      el("div", { style: "display:flex;justify-content:flex-end;margin-top:6px;" }, saveSummaryBtn)
    )
  );

  // Tech stack
  const stackRow = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;" });
  const newTech = el("input", { class: "input", placeholder: "Add a technology…" });
  function paintStack() {
    stackRow.textContent = "";
    for (const tech of memory.tech_stack ?? []) {
      const chip = el("span", { class: "chip" }, document.createTextNode(tech));
      chip.append(el("button", { text: "×", "aria-label": `Remove ${tech}`, onclick: async () => {
        await patch({ tech_stack: (memory.tech_stack ?? []).filter((t) => t !== tech) });
        paintStack();
      } }));
      stackRow.append(chip);
    }
    if (!(memory.tech_stack ?? []).length) stackRow.append(el("span", { class: "faint", text: "Nothing recorded yet." }));
  }
  paintStack();
  newTech.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const value = newTech.value.trim();
    if (!value || (memory.tech_stack ?? []).includes(value)) return;
    await patch({ tech_stack: [...(memory.tech_stack ?? []), value] });
    newTech.value = "";
    paintStack();
  });
  inner.append(
    el("section", {},
      el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);", text: "Tech Stack" }),
      stackRow,
      newTech
    )
  );

  // Decisions
  const decisionsList = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
  function paintDecisions() {
    decisionsList.textContent = "";
    const sorted = [...(memory.decisions ?? [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!sorted.length) decisionsList.append(el("p", { class: "faint", text: "No decisions logged yet." }));
    for (const d of sorted) {
      decisionsList.append(
        el("div", { class: "memory-row" },
          roleDot(d.role),
          el("div", { style: "flex:1;min-width:0;" },
            el("div", { text: d.text }),
            el("div", { class: "faint", text: new Date(d.created_at).toLocaleString() })
          ),
          el("button", { class: "btn small danger", text: "Remove", onclick: async () => {
            await patch({ decisions: (memory.decisions ?? []).filter((x) => x.id !== d.id) });
            paintDecisions();
          } })
        )
      );
    }
  }
  paintDecisions();
  inner.append(
    el("section", {},
      el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);", text: "Decisions Log" }),
      decisionsList
    )
  );

  // Open issues
  const issuesList = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
  const newIssue = el("input", { class: "input", placeholder: "Add an issue…" });
  function paintIssues() {
    issuesList.textContent = "";
    const sorted = [...(memory.open_issues ?? [])].sort((a, b) =>
      a.status === b.status ? 0 : a.status === "open" ? -1 : 1
    );
    if (!sorted.length) issuesList.append(el("p", { class: "faint", text: "No open issues." }));
    for (const issue of sorted) {
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = issue.status === "resolved";
      checkbox.addEventListener("change", async () => {
        await patch({
          open_issues: (memory.open_issues ?? []).map((i) =>
            i.id === issue.id ? { ...i, status: checkbox.checked ? "resolved" : "open" } : i
          ),
        });
        paintIssues();
      });
      issuesList.append(
        el("div", { class: "memory-row" },
          checkbox,
          el("div", {
            style: `flex:1;min-width:0;${issue.status === "resolved" ? "text-decoration:line-through;color:var(--text-faint);" : ""}`,
            text: issue.text,
          }),
          el("button", { class: "btn small danger", text: "Remove", onclick: async () => {
            await patch({ open_issues: (memory.open_issues ?? []).filter((i) => i.id !== issue.id) });
            paintIssues();
          } })
        )
      );
    }
  }
  paintIssues();
  newIssue.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const text = newIssue.value.trim();
    if (!text) return;
    await patch({
      open_issues: [...(memory.open_issues ?? []), { id: crypto.randomUUID(), text, status: "open", created_at: new Date().toISOString() }],
    });
    newIssue.value = "";
    paintIssues();
  });
  inner.append(
    el("section", {},
      el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);", text: "Open Issues" }),
      issuesList,
      newIssue
    )
  );
}

// ---------- Cost Meter ----------
export async function renderCost(inner, projectId) {
  const head = el("div", { style: "display:flex;align-items:center;justify-content:space-between;" });
  head.append(
    el("div", {},
      el("h2", { class: "section-title", text: "Cost Meter" }),
      el("p", { class: "section-sub", text: "Token usage and estimated spend across every pipeline run in this project." })
    )
  );
  const refreshBtn = el("button", { class: "btn small", text: "Refresh" });
  head.append(refreshBtn);
  inner.append(head);

  const body = el("div", {});
  inner.append(body);

  async function load() {
    body.textContent = "";
    body.append(el("p", { class: "faint", text: "Loading…" }));
    let runs = [];
    let steps = [];
    try {
      const data = await getCost(projectId);
      runs = data.runs ?? [];
      steps = data.steps ?? [];
    } catch (err) {
      body.textContent = "";
      body.append(el("p", { class: "error-text", text: err.message }));
      return;
    }

    const totalIn = steps.reduce((s, x) => s + (x.tokens_in ?? 0), 0);
    const totalOut = steps.reduce((s, x) => s + (x.tokens_out ?? 0), 0);
    const cost = (step) => (step.model ? estimateCostUsd(step.model, step.tokens_in ?? 0, step.tokens_out ?? 0) ?? 0 : 0);
    const totalCost = steps.reduce((s, x) => s + cost(x), 0);
    const hasUnknown = steps.some((x) => x.model && !estimateCostUsd(x.model, 0, 0));

    body.textContent = "";

    body.append(
      el("div", { class: "stat-grid" },
        el("div", { class: "glass stat-card" },
          el("div", { class: "stat-label", text: "Total tokens in" }),
          el("div", { class: "stat-value", text: totalIn.toLocaleString() })
        ),
        el("div", { class: "glass stat-card" },
          el("div", { class: "stat-label", text: "Total tokens out" }),
          el("div", { class: "stat-value", text: totalOut.toLocaleString() })
        ),
        el("div", { class: "glass stat-card" },
          el("div", { class: "stat-label", text: "Estimated cost" }),
          el("div", { class: "stat-value", text: formatUsd(totalCost) })
        )
      )
    );
    if (hasUnknown) {
      body.append(el("p", { class: "faint", text: "Some steps used a model without known pricing — their cost isn't included above." }));
    }

    // By role
    const byRole = el("div", { style: "display:flex;flex-direction:column;gap:6px;" });
    for (const role of ROLES) {
      const roleSteps = steps.filter((s) => s.role === role);
      const inTok = roleSteps.reduce((s, x) => s + (x.tokens_in ?? 0), 0);
      const outTok = roleSteps.reduce((s, x) => s + (x.tokens_out ?? 0), 0);
      const roleCost = roleSteps.reduce((s, x) => s + cost(x), 0);
      byRole.append(
        el("div", { class: "role-row", style: `--role-color:${ROLE_COLORS[role]}` },
          roleDot(role),
          el("span", { class: "role-label", text: ROLE_LABELS[role] }),
          el("span", { class: "faint", style: "flex:1;", text: `${roleSteps.length} call${roleSteps.length === 1 ? "" : "s"} · ${inTok.toLocaleString()} in / ${outTok.toLocaleString()} out` }),
          el("span", { class: "mono", style: "font-size:12px;", text: formatUsd(roleCost) })
        )
      );
    }
    body.append(
      el("section", {},
        el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);margin-top:22px;", text: "By Role" }),
        byRole
      )
    );

    // By run
    const byRun = el("ul", { style: "list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;" });
    const stepsByRun = new Map();
    for (const s of steps) {
      if (!stepsByRun.has(s.run_id)) stepsByRun.set(s.run_id, []);
      stepsByRun.get(s.run_id).push(s);
    }
    for (const run of runs) {
      const runSteps = stepsByRun.get(run.id) ?? [];
      const runCost = runSteps.reduce((s, x) => s + cost(x), 0);
      byRun.append(
        el("li", { class: "glass memory-row", style: "align-items:center;" },
          el("div", { style: "flex:1;min-width:0;" },
            el("div", { style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", text: run.user_message }),
            el("div", { class: "faint", text: `${run.mode} · ${new Date(run.created_at).toLocaleString()}` })
          ),
          el("span", { class: "mono", style: "font-size:12px;", text: formatUsd(runCost) })
        )
      );
    }
    if (!runs.length) byRun.append(el("li", { class: "faint", text: "No pipeline runs yet." }));
    body.append(
      el("section", {},
        el("h3", { class: "section-title", style: "font-size:13px;color:var(--text-dim);margin-top:22px;", text: "By Run" }),
        byRun
      )
    );
  }

  refreshBtn.addEventListener("click", load);
  load();
}

function formatUsd(n) {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
