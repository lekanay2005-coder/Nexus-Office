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
  { provider: "google", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};
