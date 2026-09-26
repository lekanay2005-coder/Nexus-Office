// Nexus Office brand assets (Addendum 4).
//
// Single source of truth for the "Built with Nexus Office" watermark badge so
// the exact same visual appears in the Code Canvas live preview, on deployed
// sites, and in any future React surface (PDF/doc export, etc.).
//
// The watermark is ALWAYS injected at render/deploy time only — these helpers
// never write into the user's files table, canvas content, or repo sources.

export const NEXUS_LANDING_URL =
  process.env.NEXT_PUBLIC_NEXUS_URL || "https://nexus-office.app";

// sessionStorage key: dismissing the badge hides it for that browser session
// only and never changes the project-level settings toggles.
export const WATERMARK_DISMISS_KEY = "nx-wm-dismissed";

// Role-accent gradient: cyan → amber → pink.
export const WATERMARK_GRADIENT =
  "linear-gradient(135deg, #22d3ee 0%, #f59e0b 52%, #ec4899 100%)";

// Geometric "N" mark — same visual language as the role glyphs (bold white
// initial on a small rounded tile), reused here for the brand mark.
// In the React component the logo PNG (/logo.png) renders inside the gradient
// tile; this inline SVG is the fallback used by the self-contained vanilla
// snippet (deployed sites) so it stays dependency-free.
export const N_MARK_SVG =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 13V3.5l9 9V3" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const WATERMARK_CSS = `
.nx-wm{position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:1px;opacity:.4;transition:opacity .18s ease;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.nx-wm:hover{opacity:1}
.nx-wm-pill{display:flex;align-items:center;gap:7px;height:30px;padding:0 9px 0 5px;border-radius:9999px;border:1px solid transparent;background:linear-gradient(rgba(12,12,16,.78),rgba(12,12,16,.78)) padding-box,${WATERMARK_GRADIENT} border-box;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.35);text-decoration:none;cursor:pointer}
.nx-wm-pill:hover{text-decoration:none}
.nx-wm-mark{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;flex:none;background-image:${WATERMARK_GRADIENT};background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M3.5 13V3.5l9 9V3' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"),${WATERMARK_GRADIENT};background-size:12px 12px,100% 100%;background-position:center,center;background-repeat:no-repeat,no-repeat}
.nx-wm-mark img{width:12px;height:12px;display:block;border-radius:2px}
.nx-wm-text{font-size:11.5px;font-weight:600;letter-spacing:.01em;color:#f5f5f5;white-space:nowrap}
.nx-wm-close{appearance:none;border:0;background:transparent;color:rgba(255,255,255,.5);font-size:14px;line-height:1;padding:4px 3px;cursor:pointer}
.nx-wm-close:hover{color:#fff}
`.trim();

// Landing URL used by both the React badge and the deployed-site snippet.
// Absolute so it resolves from any deployed origin.
const LOGO_URL = `${NEXUS_LANDING_URL.replace(/\/$/, "")}/logo.png`;

// Badge markup shared by the vanilla snippet (preview + deployed sites) and the
// React <NexusWatermark /> component.
export function watermarkMarkup(): string {
  const href = NEXUS_LANDING_URL.replace(/"/g, "&quot;");
  return (
    `<div data-nx-watermark class="nx-wm">` +
    `<a class="nx-wm-pill" href="${href}" target="_blank" rel="noopener noreferrer">` +
    `<span class="nx-wm-mark"><img src="${LOGO_URL}" alt="" width="12" height="12" loading="lazy" onerror="this.style.display='none'"></span>` +
    `<span class="nx-wm-text">Built with Nexus Office</span>` +
    `</a>` +
    `<button type="button" class="nx-wm-close" aria-label="Dismiss Nexus Office watermark">&times;</button>` +
    `</div>`
  );
}

// Dismiss wiring for the vanilla snippet. sessionStorage is wrapped in
// try/catch because sandboxed iframes (and some privacy modes) throw on access.
function watermarkScript(): string {
  return (
    `(function(){` +
    `try{if(window.sessionStorage.getItem("${WATERMARK_DISMISS_KEY}")==="1")return;}catch(e){}` +
    `var w=document.querySelector("[data-nx-watermark]");if(!w)return;` +
    `var b=w.querySelector(".nx-wm-close");` +
    `if(b)b.addEventListener("click",function(ev){` +
    `ev.preventDefault();ev.stopPropagation();` +
    `if(w&&w.parentNode)w.parentNode.removeChild(w);` +
    `try{window.sessionStorage.setItem("${WATERMARK_DISMISS_KEY}","1");}catch(e){}` +
    `});` +
    `})();`
  );
}

// Full self-contained snippet (style + markup + dismiss script). Used for the
// live preview iframe srcdoc and for deployed HTML.
export function renderWatermark(): string {
  return (
    `<style data-nx-wm-style>${WATERMARK_CSS}</style>` +
    watermarkMarkup() +
    `<script>${watermarkScript()}</script>`
  );
}

// Appends the watermark snippet to an HTML document at render/deploy time.
// Idempotent, and never mutates the original string's meaning for storage —
// callers only ever pass in-memory copies.
export function injectWatermark(html: string): string {
  if (!html || html.includes("data-nx-watermark")) return html;
  const snippet = renderWatermark();
  const lower = html.toLowerCase();
  const bodyClose = lower.lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + snippet + html.slice(bodyClose);
  }
  const htmlClose = lower.lastIndexOf("</html>");
  if (htmlClose !== -1) {
    return html.slice(0, htmlClose) + snippet + html.slice(htmlClose);
  }
  return html + snippet;
}
