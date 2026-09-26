"use client";

import { useCallback, useSyncExternalStore } from "react";
import NexusLogo from "@/components/brand/NexusLogo";
import {
  NEXUS_LANDING_URL,
  WATERMARK_DISMISS_KEY,
  WATERMARK_GRADIENT,
} from "@/lib/brand";

// sessionStorage (the per-session dismissal store) is external state, so it's
// read via useSyncExternalStore — no setState-in-effect. Dismissal is
// broadcast through a custom event because sessionStorage writes don't fire
// the `storage` event in the same tab.
const WM_CHANGE_EVENT = "nx-wm-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(WM_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WM_CHANGE_EVENT, onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.sessionStorage.getItem(WATERMARK_DISMISS_KEY) !== "1";
  } catch {
    return true; // sessionStorage unavailable (privacy mode etc.) — show it.
  }
}

function getServerSnapshot(): boolean {
  return true; // SSR: always render; the client reconciles on hydration.
}

// React twin of the vanilla watermark snippet in lib/brand.ts. Same geometry,
// same gradient, same session-dismiss behavior — so preview, deployed sites,
// and any in-app surface (e.g. a future docs export) stay visually identical.
export default function NexusWatermark() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dismiss = useCallback(() => {
    try {
      window.sessionStorage.setItem(WATERMARK_DISMISS_KEY, "1");
    } catch {
      // Ignore — hiding for this render is enough.
    }
    window.dispatchEvent(new Event(WM_CHANGE_EVENT));
  }, []);

  if (!visible) return null;

  return (
    <div
      data-nx-watermark
      className="fixed bottom-3.5 right-3.5 z-[2147483000] flex items-center opacity-40 transition-opacity duration-150 hover:opacity-100"
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
    >
      <a
        href={NEXUS_LANDING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-[30px] items-center gap-[7px] rounded-full border-0 py-0 pl-[5px] pr-[9px] no-underline shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
        style={{
          background: `linear-gradient(rgba(12,12,16,.78),rgba(12,12,16,.78)) padding-box, ${WATERMARK_GRADIENT} border-box`,
          border: "1px solid transparent",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <span
          className="flex h-5 w-5 flex-none items-center justify-center rounded-[7px]"
          style={{ background: WATERMARK_GRADIENT }}
        >
          {/* Inline SVG mark as fallback (deployed-site snippet has no React); the
              logo image is the primary render for the React component. */}
          <NexusLogo surface="watermark" className="h-full w-full" />
        </span>
        <span className="whitespace-nowrap text-[11.5px] font-semibold tracking-[0.01em] text-neutral-100">
          Built with Nexus Office
        </span>
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss Nexus Office watermark"
        className="cursor-pointer border-0 bg-transparent px-[3px] py-1 text-sm leading-none text-white/50 hover:text-white"
      >
        &times;
      </button>
    </div>
  );
}
