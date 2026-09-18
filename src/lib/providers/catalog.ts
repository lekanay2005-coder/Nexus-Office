import type { ProviderName } from "./index";

export interface ModelOption {
  provider: ProviderName;
  model: string;
  label: string;
}

// A short curated list per provider — enough for the Model Router dropdown
// without trying to stay perfectly in sync with every provider's catalog.
export const MODEL_CATALOG: ModelOption[] = [
  { provider: "anthropic", model: "claude-opus-4-1", label: "Claude Opus 4.1" },
  { provider: "anthropic", model: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { provider: "openai", model: "gpt-5", label: "GPT-5" },
  { provider: "openai", model: "gpt-5-mini", label: "GPT-5 Mini" },
  { provider: "openai", model: "gpt-4o", label: "GPT-4o" },
  { provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
  { provider: "google", model: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
];

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

// Illustrative USD price per 1M tokens — approximate list prices, not fetched
// live. Good enough for the Cost Meter's running estimate; an unmatched
// model just shows raw token counts with no dollar figure.
export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-opus-4-1": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-5-20250929": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1, outputPer1M: 5 },
  "gpt-5": { inputPer1M: 5, outputPer1M: 15 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  // Google's 3.x line is new enough that list pricing isn't in here yet —
  // the Cost Meter falls back to showing raw token counts for these.
};

export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (tokensIn / 1_000_000) * pricing.inputPer1M + (tokensOut / 1_000_000) * pricing.outputPer1M;
}
