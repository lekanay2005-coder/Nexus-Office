// Audit Log (Addendum 3): a filterable, searchable read-only timeline of
// every action in the project — pipeline steps per role, file writes,
// GitHub commits, deploys, key changes, permissions, approvals.

import { el } from "./util.js";
import { listAudit } from "./api.js";
import { ROLE_COLORS, ROLE_LABELS } from "./roles.js";

const ACTORS = ["user", "strategist", "builder", "analyst", "qa", "ops", "system"];

function actorColor(actor) {
  if (actor === "user") return "var(--accent)";
  if (actor === "system") return "var(--text-faint, #5d6470)";
  return ROLE_COLORS[actor] ?? "var(--text-dim)";
}

function actorLabel(actor) {
  if (actor === "user" || actor === "system") return actor[0].toUpperCase() + actor.slice(1);
  return ROLE_LABELS[actor] ?? actor;
}

function formatAction(action) {
  return action.replace(/[._]/g, " ");
}

function metadataChips(metadata) {
  if (!metadata || typeof metadata !== "object") return [];
  const skip = new Set(["provider", "model"]); // shown inline already where relevant
  const chips = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (skip.has(key)) continue;
    let text;
    if (Array.isArray(value)) text = value.length ? `${key}: ${value.join(", ")}` : null;
    else if (value === null || value === undefined) text = null;
    else if (typeof value === "object") text = `${key}: ${JSON.stringify(value)}`;
    else text = `${key}: ${value}`;
    if (text) chips.push(text);
  }
  return chips;
}

export async function renderAudit(inner, projectId) {
  inner.append(
    el("div", {},
      el("h2", { class: "section-title", text: "Audit Log" }),
      el("p", { class: "section-sub", text: "Every action in this project, traceable — pipeline runs per role, file writes, commits, deploys, key and permission changes." })
    )
  );

  // ---- Filter bar ----
  const actorSelect = el("select", { class: "input", "aria-label": "Filter by actor" },
    el("option", { value: "", text: "All actors" }),
    ...ACTORS.map((a) => el("option", { value: a, text: actorLabel(a) }))
  );
  const actionInput = el("input", {
    class: "input",
    placeholder: "Action (e.g. pipeline, deploy)…",
    "aria-label": "Filter by action",
  });
  const searchInput = el("input", {
    class: "input",
    placeholder: "Search action or target…",
    "aria-label": "Search audit log",
  });
  const fromInput = el("input", { class: "input", type: "date", "aria-label": "From date" });
  const toInput = el("input", { class: "input", type: "date", "aria-label": "To date" });
  const refreshBtn = el("button", { class: "btn", text: "Refresh", onclick: () => load() });

  const bar = el("div", { class: "audit-filters" }, actorSelect, actionInput, searchInput, fromInput, toInput, refreshBtn);
  inner.append(bar);

  const timeline = el("div", { class: "audit-timeline", "aria-live": "polite" });
  inner.append(timeline);

  let loading = false;

  async function load() {
    if (loading) return;
    loading = true;
    timeline.textContent = "";
    timeline.append(el("p", { class: "faint", text: "Loading…" }));
    try {
      const { events } = await listAudit(projectId, {
        actor: actorSelect.value,
        action: actionInput.value.trim(),
        q: searchInput.value.trim(),
        from: fromInput.value,
        to: toInput.value,
      });

      timeline.textContent = "";
      if (!events.length) {
        timeline.append(el("p", { class: "faint", text: "No matching events. Actions appear here as you use the office." }));
        return;
      }

      let lastDay = "";
      for (const event of events) {
        const day = new Date(event.created_at).toDateString();
        if (day !== lastDay) {
          lastDay = day;
          timeline.append(el("div", { class: "audit-day", text: day }));
        }
        timeline.append(renderEvent(event));
      }
    } catch (err) {
      timeline.textContent = "";
      timeline.append(el("p", { class: "error-text", text: err.message }));
    }
    loading = false;
  }

  function renderEvent(event) {
    const color = actorColor(event.actor);
    const row = el("div", { class: "glass audit-event", style: `--event-color:${color}` });

    const dot = el("span", { class: "audit-dot", style: `--event-color:${color}` });
    dot.setAttribute("aria-hidden", "true");

    const main = el("div", { class: "audit-main" });
    main.append(
      el("div", { class: "audit-head" },
        el("span", { class: "audit-actor", style: `--event-color:${color}`, text: actorLabel(event.actor) }),
        el("span", { class: "audit-action", text: formatAction(event.action) }),
        event.target ? el("span", { class: "audit-target", text: event.target }) : null
      )
    );
    for (const chip of metadataChips(event.metadata)) {
      main.append(el("span", { class: "audit-chip", text: chip }));
    }

    const time = el("time", { class: "audit-time", datetime: event.created_at, text: timeAgo(event.created_at) });

    row.append(dot, main, time);
    row.title = new Date(event.created_at).toLocaleString();
    return row;
  }

  for (const input of [actorSelect, actionInput, searchInput, fromInput, toInput]) {
    input.addEventListener("change", () => load());
  }

  await load();
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}
