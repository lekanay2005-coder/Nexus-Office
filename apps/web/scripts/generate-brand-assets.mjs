// Generates public/brand/*.png from public/logo.png (512x512) + public/background.png.
// Placeholder art is synthesized if the source assets don't exist yet, so this
// runs on a fresh clone; drop in real assets and re-run: `npm run assets`.
// Dev-only tooling — never runs inside `next build`. sharp is already in the
// dependency tree (Next 16 requires it for image optimization).

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const PUBLIC = path.resolve("public");
const BRAND = path.join(PUBLIC, "brand");
fs.mkdirSync(BRAND, { recursive: true });

// ---------------------------------------------------------------------------
// Placeholder art (only used when the real asset is missing)
// ---------------------------------------------------------------------------

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22d3ee"/><stop offset="0.52" stop-color="#f59e0b"/><stop offset="1" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0B0D12"/>
  <rect x="28" y="28" width="456" height="456" rx="92" fill="none" stroke="url(#g)" stroke-width="20"/>
  <path d="M150 356V156l212 200V156" stroke="#f5f5f5" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0B0D12"/><stop offset="1" stop-color="#10131c"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#22d3ee"/><stop offset="0.5" stop-color="#f59e0b"/><stop offset="1" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <g fill="#22d3ee" opacity="0.16">
    ${Array.from({ length: 48 }, (_, i) => {
      const x = 20 + (i * 397) % 1880;
      const h = 40 + ((i * 131) % 200);
      const y = (i * 733) % 880;
      return `<rect x="${x}" y="${y}" width="2.5" height="${h}"/>`;
    }).join("")}
  </g>
  <g fill="#ec4899" opacity="0.10">
    ${Array.from({ length: 36 }, (_, i) => {
      const x = 40 + (i * 503) % 1840;
      const h = 30 + ((i * 97) % 160);
      const y = (i * 419) % 900;
      return `<rect x="${x}" y="${y}" width="2" height="${h}"/>`;
    }).join("")}
  </g>
  <rect x="0" y="0" width="1920" height="6" fill="url(#acc)" opacity="0.55"/>
  <rect x="0" y="1074" width="1920" height="6" fill="url(#acc)" opacity="0.35"/>
</svg>`;

async function ensureSource(file, svgHtml, size = 512) {
  const p = path.join(PUBLIC, file);
  if (fs.existsSync(p)) {
    console.log(`  = public/${file} (exists, keeping)`);
    return p;
  }
  await sharp(Buffer.from(svgHtml), { density: 96 }).resize(size, size).png().toFile(p);
  console.log(`  + public/${file} (generated placeholder, ${size}x${size})`);
  return p;
}

// ---------------------------------------------------------------------------
// Icon size derivation
// ---------------------------------------------------------------------------

const ICON_SIZES = [16, 32, 180, 192, 512];

async function main() {
  console.log("Nexus Office brand assets:");

  const logoPath = await ensureSource("logo.png", LOGO_SVG);
  // favicon.png is specified as 32x32.
  await ensureSource("favicon.png", LOGO_SVG, 32);

  // background.png is standalone — generate at 1920x1080 if missing.
  const bgPath = path.join(PUBLIC, "background.png");
  if (!fs.existsSync(bgPath)) {
    await sharp(Buffer.from(BG_SVG), { density: 96 }).resize(1920, 1080).png().toFile(bgPath);
    console.log("  + public/background.png (generated placeholder)");
  } else {
    console.log("  = public/background.png (exists, keeping)");
  }

  for (const size of ICON_SIZES) {
    await sharp(logoPath)
      .resize(size, size, { fit: "cover", position: "centre" })
      .png()
      .toFile(path.join(BRAND, `icon-${size}.png`));
  }
  // Full-quality 512 copy of the logo for the manifest's 512 entry + OG image.
  await sharp(logoPath).png().toFile(path.join(BRAND, "icon-512.png"));

  console.log(`  + public/brand/icon-{${ICON_SIZES.join(",")}}.png`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
