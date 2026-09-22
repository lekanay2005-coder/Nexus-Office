"use client";

import Image from "next/image";
import { useState } from "react";
import HackerGlow from "./HackerGlow";

// Addendum 6: single responsive logo component used by the workspace nav,
// projects/prompts headers, the login card, and <NexusWatermark />.
// next/image serves appropriately sized variants per device rather than always
// shipping the full 512x512 file; the `sizes` hint keeps fetches correct at
// every breakpoint (320px → 2560px).
const SURFACES = {
  nav: {
    className: "h-8 w-8", // 28–32px, fixed across all widths
    sizes: "32px",
    priority: false,
  },
  hero: {
    // 120–160px desktop, ~60–80px mobile via clamp() — never fixed px, never
    // horizontal scroll, no layout shift.
    className: "h-[clamp(60px,12vw,160px)] w-[clamp(60px,12vw,160px)]",
    sizes: "(max-width: 768px) 64px, 128px",
    priority: true,
  },
  card: {
    className: "h-14 w-14", // 56px, centered, consistent across devices
    sizes: "56px",
    priority: false,
  },
  watermark: {
    className: "h-5 w-5 rounded-[7px] overflow-hidden", // matches the 20px mark tile
    sizes: "20px",
    priority: false,
  },
} as const;

type Surface = keyof typeof SURFACES;

export default function NexusLogo({
  surface,
  className = "",
  glow = false,
}: {
  surface: Surface;
  className?: string;
  /** Dense/bright code-rain halo behind the mark (brand surfaces only). */
  glow?: boolean;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  if (loadFailed) return null;
  const cfg = SURFACES[surface];
  return (
    <span className={`relative inline-flex select-none ${cfg.className} ${className}`}>
      {glow && <HackerGlow className="-inset-3" />}
      <Image
        src="/logo.png"
        alt="Nexus Office logo"
        className="relative h-full w-full select-none object-contain"
        width={512}
        height={512}
        sizes={cfg.sizes}
        priority={cfg.priority}
        onError={() => setLoadFailed(true)}
        draggable={false}
      />
    </span>
  );
}
