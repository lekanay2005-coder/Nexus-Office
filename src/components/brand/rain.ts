// Shared "Matrix code rain" engine for the Nexus Office brand background.
// One <canvas>, requestAnimationFrame, no external library. Used by:
// - <HackerBackground /> (full-viewport ambient layer, mounted in root layout)
// - <HackerGlow />       (dense, brighter halo behind the logo mark)
//
// Contract:
// - ~30fps cap (background ambiance, doesn't need 60)
// - paused via cancelAnimationFrame while document.hidden
// - prefers-reduced-motion: reduce => a single static frame, no loop
// - transparent canvas (the #0B0D12 floor comes from .nx-backdrop underneath)
// - pointer-events: none is applied by the mounting component, never here

export interface RainOptions {
  /** CSS pixel font size for the glyphs. */
  fontSize?: number;
  /** Column spacing multiplier: higher = sparser columns. */
  density?: number;
  /** Fall speed in rows per second (fractional speeds allowed). */
  speed?: number;
  /** Glyph opacity 0..1 (multiplied into each drawn character). */
  alpha?: number;
  /** Head glyph opacity — the leading character of each column. */
  headAlpha?: number;
  /** Green tint. Ambient uses the spec's #39FF88. */
  color?: string;
  /** Seed the very first frame pre-filled so it never starts empty. */
  prefill?: boolean;
  /**
   * Dark scrim painted over the whole canvas each frame, 0..1 (Addendum 8).
   * Adds contrast so glyphs stay legible over brighter background imagery.
   * Applied after drawing, so it never muddies the glyph colors themselves.
   */
  dim?: number;
}

const GLYPHS =
  "アカサタナハマヤラワ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ{}<>/;=";

// Seeded PRNG so a static reduced-motion frame is deterministic across
// renders (and SSR-safe: engine only ever runs client-side).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startRain(
  canvas: HTMLCanvasElement,
  opts: RainOptions = {}
): () => void {
  const {
    fontSize = 14,
    density = 1.9, // ≈ every ~1.9 font-widths — sparse
    speed = 5.2, // rows per second — slow drift
    alpha = 0.1,
    headAlpha = 0.22,
    color = "#39ff88",
    prefill = true,
    dim = 0,
  } = opts;

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let columns = 0;
  let ys: number[] = [];
  let chars: string[] = [];
  let speeds: number[] = [];
  let raf = 0;
  let last = 0;
  let lastPaint = 0;
  const FRAME_MIN = 1000 / 30; // 30fps cap
  const rand = mulberry32(0x4e65787573); // "NexuS"

  const glyph = () => GLYPHS[(rand() * GLYPHS.length) | 0];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    const step = Math.max(fontSize * density, 18);
    const next = Math.max(12, Math.min(48, Math.round(w / step)));
    if (next !== columns) {
      columns = next;
      ys = Array.from({ length: columns }, () => rand() * 80);
      chars = Array.from({ length: columns }, glyph);
      speeds = Array.from({ length: columns }, () => speed * (0.7 + rand() * 0.6));
    }
  }

  function draw(dt: number) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const step = Math.max(fontSize * density, 18);
    const rows = h / fontSize;

    ctx!.clearRect(0, 0, w, h);
    ctx!.font = `${fontSize}px ui-monospace, "JetBrains Mono", Menlo, monospace`;
    ctx!.textAlign = "center";

    for (let i = 0; i < columns; i++) {
      const x = (i + 0.5) * step;
      const y = ys[i] * fontSize;

      // Tail glyph fades out a few rows above the head.
      const tailY = y - fontSize * 1.6;
      if (tailY > 0) {
        ctx!.fillStyle = color;
        ctx!.globalAlpha = alpha * 0.55;
        ctx!.fillText(chars[i], x, tailY);
      }

      // Head glyph.
      ctx!.fillStyle = color;
      ctx!.globalAlpha = headAlpha;
      ctx!.fillText(chars[i], x, y);

      ys[i] += speeds[i] * dt;
      if (rand() < 0.12) chars[i] = glyph();

      // Off the bottom: reset to top with a fresh character.
      if (y - fontSize > h) {
        ys[i] = rand() * -8;
        chars[i] = glyph();
        speeds[i] = speed * (0.7 + rand() * 0.6);
      }
    }

    ctx!.globalAlpha = 1;

    // Full-canvas scrim (see `dim` in RainOptions). Painted last so it sits
    // over the glyphs, dimming the backdrop image underneath the canvas
    // without touching page content above it.
    if (dim > 0) {
      ctx!.fillStyle = `rgba(11, 13, 18, ${dim})`;
      ctx!.fillRect(0, 0, w, h);
    }

    void rows;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    // 30fps cap: skip frames that arrive sooner than ~33ms. dt still uses the
    // real elapsed time since the last PAINT, so motion speed is unchanged.
    if (now - lastPaint < FRAME_MIN) return;
    const dt = Math.min((now - (lastPaint || now - FRAME_MIN)) / 1000, 0.1);
    lastPaint = now;
    last = now;
    draw(dt);
  }

  function onVisibility() {
    if (document.visibilityState === "visible") {
      if (!raf && !reducedMotion) {
        last = 0;
        lastPaint = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function start() {
    resize();
    if (prefill) {
      // Paint one frame so the canvas is never blank on mount.
      draw(0);
    }
    if (reducedMotion) return; // single static frame only
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") {
      raf = requestAnimationFrame(frame);
    }
  }

  const onResize = () => {
    const wasStatic = reducedMotion || !raf;
    resize();
    if (wasStatic) draw(0);
  };
  window.addEventListener("resize", onResize);

  start();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", onResize);
  };
}
