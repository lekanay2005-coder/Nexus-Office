"use client";

// A pure-CSS soft blur halo that glows faintly behind a brand mark
// (logo hero / card). The mark's own badge stays solid — this div sits
// entirely behind it and only shows around the edges as a halo. No canvas,
// no falling characters — just a colored blur that respects
// prefers-reduced-motion (disabled entirely in that mode).
//
// Per Addendum 5 section 3: "Only the optional HackerGlow variant (a soft
// blur halo, no visible characters) is allowed near the logo."
//
// Replaced the old canvas-rain implementation that was rendering visible
// glyphs inside the logo's bounding box.
export default function HackerGlow({
  className = "",
  color = "#39ff88",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-[inherit] blur-[1.5px] opacity-55 ${className} motion-reduce:blur-[1px] motion-reduce:opacity-40`}
      style={{
        boxShadow: `0 0 0 8px color-mix(in srgb, ${color} 85%, transparent), 0 0 12px 4px color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    />
  );
}
