// Approval-gating modal (Addendum 3): shown before risky production
// actions — GitHub commits, production deploys, integration deletion.
// Resolves true (approved) or false (cancelled); callers log rejections
// to the audit log and approvals are logged server-side.

import { logAuditEvent } from "./api.js";

// Runs an action through the approval flow: the first attempt goes out
// unconfirmed; if the server answers 409 APPROVAL_REQUIRED, the modal
// shows the summary and (on approve) retries with confirmed=true.
// Resolves the action's result, or null when the user cancelled.
export async function runWithApproval(projectId, attempt) {
  try {
    return await attempt(false);
  } catch (err) {
    if (err?.status !== 409 || !err.data?.approval) throw err;
    const approved = await showConfirm(err.data.approval);
    if (!approved) {
      try {
        await logAuditEvent(projectId, {
          action: "approval.rejected",
          target: err.data.approval.kind,
          metadata: { kind: err.data.approval.kind },
        });
      } catch {
        // Rejection logging is best-effort.
      }
      return null;
    }
    return attempt(true);
  }
}

export function showConfirm({ title, lines, approveLabel = "Approve" }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const card = document.createElement("div");
    card.className = "glass modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", title);

    const icon = document.createElement("div");
    icon.className = "modal-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠";

    const h3 = document.createElement("h3");
    h3.textContent = title;

    const sub = document.createElement("p");
    sub.className = "section-sub";
    sub.textContent = "This is a production action. Review exactly what will happen:";

    const list = document.createElement("ul");
    list.className = "modal-lines";
    for (const line of lines ?? []) {
      const li = document.createElement("li");
      li.textContent = line;
      list.append(li);
    }

    const row = document.createElement("div");
    row.className = "modal-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Cancel";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn primary danger-accent";
    approve.textContent = approveLabel;

    function close(result) {
      window.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") close(false);
    }

    approve.addEventListener("click", () => close(true));
    cancel.addEventListener("click", () => close(false));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close(false);
    });
    window.addEventListener("keydown", onKey);

    row.append(cancel, approve);
    card.append(icon, h3, sub, list, row);
    backdrop.append(card);
    document.body.append(backdrop);
    approve.focus();
  });
}
