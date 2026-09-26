// Real-API-backed sync status pill: "Synced" / "Saving…" / "Sync failed —
// tap to retry". State is driven by actual save outcomes, never timers.

export function createSyncStatus(canvasWrap) {
  let onRetry = null;

  const pill = document.createElement("div");
  pill.className = "sync-pill";
  pill.dataset.state = "idle";
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");
  pill.textContent = "Idle";
  pill.addEventListener("click", () => {
    if (pill.dataset.state === "error" && onRetry) onRetry();
  });
  canvasWrap.append(pill);

  function render(state, label, retryHandler) {
    pill.dataset.state = state;
    pill.textContent = label;
    pill.style.display = "";
    onRetry = retryHandler ?? null;
  }

  return {
    idle: () => render("idle", "Idle"),
    saving: () => render("saving", "Saving…"),
    saved: () => render("saved", "Synced"),
    failed: (retry) => render("error", "Sync failed — tap to retry", retry),
  };
}
