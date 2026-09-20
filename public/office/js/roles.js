// Nexus Office — role registry. One source of truth for role names,
// accent colors, and inline SVG glyphs (no icon library dependency).

export const ROLES = ["strategist", "builder", "analyst", "qa", "ops"];

export const ROLE_LABELS = {
  strategist: "Strategist",
  builder: "Builder",
  analyst: "Analyst",
  qa: "QA",
  ops: "Ops",
};

export const ROLE_COLORS = {
  strategist: "#3ee0e8",
  builder: "#f5a623",
  analyst: "#a78bfa",
  qa: "#4ade80",
  ops: "#fb7185",
};

export const ROLE_GLYPHS = {
  strategist:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M15 9l-2 5-5 2 2-5 5-2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  builder:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 6.5l3 3-1.6 1.6-3-3 1.6-1.6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 8L5 16a1.5 1.5 0 0 0 0 2.1l.9.9a1.5 1.5 0 0 0 2.1 0L16 11" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  analyst:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="1.6"/><path d="M15 15l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  qa: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5l6.5 2.4v5.2c0 4.2-2.7 7.4-6.5 8.9-3.8-1.5-6.5-4.7-6.5-8.9V5.9L12 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 12.2l2 2 4-4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ops: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3c2.2 1.4 3.6 4 3.6 7.3 0 1.9-.5 3.5-1.3 4.7l-2.3 2.6-2.3-2.6c-.8-1.2-1.3-2.8-1.3-4.7C8.4 7 9.8 4.4 12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="10" r="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M9 16l-2 3.5M15 16l2 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

// Ported from src/lib/providers/catalog.ts so the Model Router and Cost
// Meter show identical data without importing from the Next app.
export const MODEL_CATALOG = [
  { provider: "anthropic", model: "claude-opus-4-1", label: "Claude Opus 4.1" },
  { provider: "anthropic", model: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { provider: "openai", model: "gpt-5", label: "GPT-5" },
  { provider: "openai", model: "gpt-5-mini", label: "GPT-5 Mini" },
  { provider: "openai", model: "gpt-4o", label: "GPT-4o" },
  { provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
  { provider: "google", model: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
];

export const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

export const DEFAULT_PROVIDER_CONFIG = { provider: "google", model: "gemini-3.6-flash" };

// Illustrative USD price per 1M tokens — mirrors MODEL_PRICING in the
// Next app's catalog; unmatched models show raw token counts only.
export const MODEL_PRICING = {
  "claude-opus-4-1": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-5-20250929": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1, outputPer1M: 5 },
  "gpt-5": { inputPer1M: 5, outputPer1M: 15 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
};

export function estimateCostUsd(model, tokensIn, tokensOut) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (
    (tokensIn / 1_000_000) * pricing.inputPer1M +
    (tokensOut / 1_000_000) * pricing.outputPer1M
  );
}

// Small circular role dot with glyph, accent-tinted via --role-color.
export function roleDot(role) {
  return `<span class="role-dot" style="--role-color:${ROLE_COLORS[role]}" title="${ROLE_LABELS[role]}">${ROLE_GLYPHS[role]}</span>`;
}
