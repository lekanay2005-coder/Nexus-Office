"use client";

import { useEffect, useRef } from "react";
import { startRain } from "./rain";

// A denser, brighter mini code-rain that glows faintly behind a brand mark
// (logo hero / card). The mark's own badge stays solid — this layer sits
// entirely behind it and only shows around the edges as a halo.
export default function HackerGlow({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startRain(canvas, {
      fontSize: 9,
      density: 1.25, // tighter columns than the ambient layer
      speed: 6.5,
      alpha: 0.5,
      headAlpha: 0.85,
    });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
    />
  );
}
