"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { startRain } from "./rain";

export type HackerIntensity = "ambient" | "reduced";

// Office Chat and Code Canvas both live under /projects/[id]; on those routes
// the rain drops to the dimmer variant automatically so it never competes with
// chat cards or code. Everything else (auth, project list, prompts) is ambient.
// Pages can also force a level via the `intensity` prop.
function intensityForPath(pathname: string | null): HackerIntensity {
  return pathname && pathname.startsWith("/projects/") ? "reduced" : "ambient";
}

// Single full-viewport code-rain layer, mounted once in the root layout.
// - fixed, inset-0, z-index -1: behind every page, above the .nx-backdrop PNG
//   (which stays as the instant-load underlay until the canvas paints).
// - pointer-events: none: never intercepts clicks.
// - ambient ≈ 10-12% opacity; reduced ≈ 5% (reading-heavy surfaces).
// - dim ≈ 0.22: full-canvas #0B0D12 scrim painted each frame so glyphs stay
//   readable over the moodier (and potentially brighter) Addendum 8
//   background imagery; tune that value if the art changes again.
export default function HackerBackground({
  intensity,
}: {
  intensity?: HackerIntensity;
}) {
  const pathname = usePathname();
  const level = intensity ?? intensityForPath(pathname);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startRain(canvas, { alpha: 0.1, headAlpha: 0.2, dim: 0.22 });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-nexus-rain={level}
      className={`nx-rain nx-rain-${level}`}
    />
  );
}
