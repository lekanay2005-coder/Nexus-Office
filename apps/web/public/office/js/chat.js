// Office Chat: streams the 5-role pipeline over SSE and renders role cards
// as each step actually completes. The relay animation is driven by the same
// events — nothing is faked with timers.

import { ROLES, ROLE_LABELS, ROLE_COLORS, ROLE_GLYPHS } from "./roles.js";
import { runPipeline } from "./api.js";
import { showToast } from "./toast.js";
import { esc } from "./util.js";

const SHORT_SEQUENCE = ["strategist", "ops"];
const FULL_SEQUENCE = ROLES;

// Client-side mirrors of the server's memory.ts block parsing, so displayed
// cards don't show raw JSON blocks and the relay sequence is known the
// moment the Strategist's step lands.
const MEMORY_BLOCK_RE = /```memory-update\s*([\s\S]*?)```/;
const STRATEGIST_BLOCK_RE = /```strategist\s*([\s\S]*?)```/;

function stripMemoryBlock(text) {
  return text.replace(MEMORY_BLOCK_RE, "").trim();
}
function stripStrategistBlock(text) {
  return text.replace(STRATEGIST_BLOCK_RE, "").trim();
}
function parseStrategistOutput(text) {
  const match = text.match(STRATEGIST_BLOCK_RE);
  if (!match) return { needsFullPipeline: true };
  try {
    return { needsFullPipeline: Boolean(JSON.parse(match[1].trim()).needs_full_pipeline) };
  } catch {
    return { needsFullPipeline: true };
  }
}

export function createChatPane(container, { onFilesWritten }) {
  const scroll = document.createElement("div");
  scroll.className = "chat-scroll";

  const empty = document.createElement("p");
  empty.className = "chat-empty";
  empty.textContent =
    "Say something to your team. Simple questions get a direct answer from the Strategist; anything requiring real work runs the full 5-role pipeline.";
  scroll.append(empty);

  const form = document.createElement("form");
  form.className = "chat-form";
  const input = document.createElement("input");
  input.className = "input";
  input.placeholder = "Ask your team anything…";
  input.setAttribute("aria-label", "Message your team");
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "btn primary";
  send.textContent = "Send";
  form.append(input, send);

  container.append(scroll, form);

  let pending = false;
  let projectId = null;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message || pending) return;
    input.value = "";
    submitMessage(message);
  });

  async function submitMessage(message) {
    if (pending) return;
    pending = true;
    input.disabled = true;
    send.disabled = true;
    empty.remove();

    const userMsg = document.createElement("div");
    userMsg.className = "chat-user";
    userMsg.textContent = message;
    scroll.append(userMsg);

    // Relay track renders before any step exists: the first node lights up
    // immediately, the rest stay dim until their step events arrive.
    const relayWrap = document.createElement("div");
    relayWrap.className = "relay-wrap";
    const relay = buildRelay();
    relayWrap.append(relay.root);
    scroll.append(relayWrap);

    const cardsHost = document.createElement("div");
    cardsHost.style.display = "flex";
    cardsHost.style.flexDirection = "column";
    cardsHost.style.gap = "12px";
    scroll.append(cardsHost);

    scroll.scrollTop = scroll.scrollHeight;

    try {
      const body = await runPipeline(projectId, message);
      await consumeStream(body, relay, cardsHost);
    } catch (err) {
      relay.failAll();
      showToast(err instanceof Error ? err.message : "Pipeline failed", "error");
    } finally {
      pending = false;
      input.disabled = false;
      send.disabled = false;
      input.focus();
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  function buildRelay() {
    const root = document.createElement("div");
    root.className = "relay";
    root.setAttribute("role", "list");
    root.setAttribute("aria-label", "Pipeline roles");
    const nodes = [];
    const links = [];

    ROLES.forEach((role, i) => {
      if (i > 0) {
        const link = document.createElement("div");
        link.className = "relay-link";
        link.style.setProperty("--link-color", ROLE_COLORS[role]);
        link.setAttribute("aria-hidden", "true");
        root.append(link);
        links.push(link);
      }
      const node = document.createElement("div");
      node.className = "relay-node";
      node.style.setProperty("--node-color", ROLE_COLORS[role]);
      node.title = ROLE_LABELS[role];
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", ROLE_LABELS[role]);
      node.innerHTML = ROLE_GLYPHS[role];
      root.append(node);
      nodes.push(node);
    });

    let activeIndex = -1;

    function setActive(i) {
      activeIndex = i;
      const node = nodes[i];
      if (!node) return;
      node.classList.add("active");
      if (i > 0) {
        // The connector into this node grows as soon as the node activates;
        // once the fill animation ends it stays solid.
        const link = links[i - 1];
        if (!link.classList.contains("filled")) {
          link.classList.add("filling");
          link.addEventListener("animationend", () => {
            link.classList.remove("filling");
            link.classList.add("filled");
          }, { once: true });
        }
      }
    }

    return {
      root,
      // Called the moment a real step event arrives: advances the animation
      // to the role that just produced output.
      advance(role) {
        const i = ROLES.indexOf(role);
        if (i === -1) return;
        if (activeIndex >= 0) {
          nodes[activeIndex].classList.remove("active");
          nodes[activeIndex].classList.add("done");
        }
        if (!nodes[i].classList.contains("done")) {
          setActive(i);
        }
      },
      finish() {
        if (activeIndex >= 0) {
          nodes[activeIndex].classList.remove("active");
          nodes[activeIndex].classList.add("done");
        }
        // If the run took the short path, dim the roles that never ran.
        nodes.forEach((n, i) => {
          if (!n.classList.contains("done") && !n.classList.contains("failed")) {
            n.style.opacity = "0.25";
          }
        });
      },
      failAll() {
        if (activeIndex >= 0) {
          nodes[activeIndex].classList.remove("active");
          nodes[activeIndex].classList.add("failed");
        }
      },
    };
  }

  function appendRoleCard(host, role, output, model) {
    const isOps = role === "ops";
    const card = document.createElement("div");
    card.className = `glass role-card${isOps ? " ops-summary" : ""}`;
    card.style.setProperty("--role-color", ROLE_COLORS[role]);

    const head = document.createElement("button");
    head.type = "button";
    head.className = "card-head";
    head.setAttribute("aria-expanded", "true");
    head.innerHTML = `
      <span class="glyph" style="--role-color:${ROLE_COLORS[role]}">${ROLE_GLYPHS[role]}</span>
      <span class="role-name">${esc(ROLE_LABELS[role])}</span>
      ${model ? `<span class="role-model">${esc(model)}</span>` : ""}
      <span class="caret" aria-hidden="true">▾</span>`;
    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = output;
    head.addEventListener("click", () => {
      const collapsed = card.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    });

    card.append(head, body);
    host.append(card);
    scroll.scrollTop = scroll.scrollHeight;
    return card;
  }

  async function consumeStream(body, relay, cardsHost) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawBuilder = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const raw of events) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        let event;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }

        if (event.type === "step") {
          relay.advance(event.step.role);
          const role = event.step.role;
          let display = event.step.output ?? "";
          if (role === "strategist") display = stripStrategistBlock(display);
          if (role === "ops") display = stripMemoryBlock(display);
          appendRoleCard(cardsHost, role, display, event.step.model);
          if (role === "builder") {
            sawBuilder = true;
          }
        } else if (event.type === "done") {
          relay.finish();
          if (sawBuilder) onFilesWritten?.();
        } else if (event.type === "error") {
          relay.failAll();
          showToast(event.message ?? "Pipeline failed", "error");
        }
      }
    }
  }

  return {
    setActiveProject(id) {
      projectId = id;
      scroll.textContent = "";
      empty.style.display = "";
      scroll.append(empty);
    },
  };
}
