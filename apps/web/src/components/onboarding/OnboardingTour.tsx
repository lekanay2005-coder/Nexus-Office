"use client";

// Addendum 13 section 3: first-time onboarding walkthrough.
// Deliberately dependency-free: a small tooltip-stepper that highlights
// elements marked with `data-tour="<key>"`. If an anchor isn't on screen
// (e.g. the user is on a different tab), the step renders as a centered
// card instead, so the tour works from any page. Completion persists
// per-user via /api/me/onboarding.

import { useCallback, useEffect, useRef, useState } from "react";

export interface TourStep {
  key: string; // matches a data-tour attribute somewhere in the app
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    key: "projects-list",
    title: "Dashboard",
    body: "This is your home base. Connect a GitHub repo to start a project.",
  },
  {
    key: "repo-picker",
    title: "GitHub repo / org picker",
    body: "Pick a repo you already have, or create one on GitHub first if you don't see it here.",
  },
  {
    key: "office-chat",
    title: "Office Chat",
    body: "Describe what you want built. Your 5-role AI team — Strategist, Builder, Analyst, QA, Ops — works through it together.",
  },
  {
    key: "code-canvas",
    title: "Code Canvas",
    body: "Your files appear here as the Builder writes them. You can edit directly too.",
  },
  {
    key: "prompt-vault",
    title: "Prompt Vault",
    body: "Save prompts you like here — they're stored in your own GitHub repo, and you can share them publicly if you want.",
  },
  {
    key: "memory-audit",
    title: "Memory Board / Audit Log",
    body: "Every decision and action is logged here so you never lose context.",
  },
  {
    key: "model-router",
    title: "Model Router / Integrations",
    body: "Add your own AI provider keys here, or use the free shared key to start.",
  },
  {
    key: "deploy-desk",
    title: "Deploy Desk",
    body: "When you're ready, deploy straight from here.",
  },
];

const STORAGE_KEY = "nexus-onboarding-seen";

export default function OnboardingTour({ autoStart }: { autoStart: boolean }) {
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const checkedRef = useRef(false);

  const current = stepIndex === null ? null : TOUR_STEPS[stepIndex];

  const locateAnchor = useCallback((key: string) => {
    // The tour can start from any page; look for the anchor, and if it's not
    // rendered, show a centered card so the sequence still completes.
    const el = document.querySelector(`[data-tour="${key}"]`);
    setAnchorRect(el ? el.getBoundingClientRect() : null);
  }, []);

  const start = useCallback(() => {
    setStepIndex(0);
    locateAnchor(TOUR_STEPS[0].key);
  }, [locateAnchor]);

  // Auto-start once for first-time users (client-side flag + server state).
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    if (localStorage.getItem(STORAGE_KEY) === "1") return;
    if (!autoStart) return;

    (async () => {
      try {
        const res = await fetch("/api/me/onboarding");
        if (res.ok) {
          const data = await res.json();
          if (!data.onboardingCompleted) start();
          else localStorage.setItem(STORAGE_KEY, "1");
        }
      } catch {
        // Can't reach the API — don't nag.
      }
    })();
  }, [autoStart, start]);

  useEffect(() => {
    if (stepIndex === null || !current) return;
    // Microtask-deferred so the effect body stays setState-free.
    const raf = requestAnimationFrame(() => locateAnchor(current.key));
    const onResize = () => locateAnchor(current.key);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [stepIndex, current, locateAnchor]);

  async function finish(completed: boolean) {
    setStepIndex(null);
    localStorage.setItem(STORAGE_KEY, "1");
    try {
      await fetch("/api/me/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
    } catch {
      // Best-effort; the local flag still prevents same-session repeats.
    }
  }

  function next() {
    if (stepIndex === null) return;
    if (stepIndex >= TOUR_STEPS.length - 1) {
      void finish(true);
    } else {
      setStepIndex(stepIndex + 1);
    }
  }

  function prev() {
    if (stepIndex !== null && stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  if (stepIndex === null || !current) {
    return (
      <button
        onClick={start}
        aria-label="Start the product tour"
        title="Take the tour"
        data-tour="help-button"
        className="fixed bottom-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-sm font-bold text-neutral-300 shadow-lg hover:border-neutral-500 hover:text-white"
      >
        ?
      </button>
    );
  }

  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Position near the anchor when it's visible; otherwise centered.
  const style: React.CSSProperties = anchorRect
    ? {
        top: Math.min(Math.max(anchorRect.bottom + 12, 16), window.innerHeight - 220),
        left: Math.min(Math.max(anchorRect.left, 16), window.innerWidth - 360),
        maxWidth: 344,
      }
    : {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxWidth: 380,
      };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="absolute inset-0 bg-black/50" onClick={() => finish(false)} />
      <div
        className="absolute w-[344px] rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
        style={style}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
            Step {stepIndex + 1} of {TOUR_STEPS.length} · {current.title}
          </span>
          <button
            onClick={() => finish(false)}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            Skip tour
          </button>
        </div>
        <p className="text-sm leading-relaxed text-neutral-200">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={prev}
            disabled={stepIndex === 0}
            className="rounded px-2.5 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
          >
            Back
          </button>
          <button
            onClick={next}
            className="rounded bg-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
