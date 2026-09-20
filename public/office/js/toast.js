// Reusable toast stack — bottom-right, auto-dismiss after 4s, slide in/out.
// showToast(message, type) with type in "success" | "error" | "info".

const STACK_ID = "toast-stack";
let stack = null;

function ensureStack() {
  if (stack && document.body.contains(stack)) return stack;
  stack = document.createElement("div");
  stack.id = STACK_ID;
  stack.className = "toast-stack";
  stack.setAttribute("role", "status");
  stack.setAttribute("aria-live", "polite");
  document.body.append(stack);
  return stack;
}

export function showToast(message, type = "info") {
  const host = ensureStack();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.append(toast);

  setTimeout(() => {
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    // Fallback removal in case animationend never fires (hidden tab etc.)
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}
