export interface CompletionRequest {
  system: string;
  prompt: string;
}

export interface CompletionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export type ProviderName = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
}

// MVP default: every role runs on Claude. The Model Router (v2) will let
// the user override this per-role via the role_models table.
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
};

export async function complete(
  config: ProviderConfig,
  req: CompletionRequest
): Promise<CompletionResult> {
  switch (config.provider) {
    case "anthropic":
      return completeAnthropic(config.model, req);
    case "openai":
      return completeOpenAI(config.model, req);
    case "google":
      return completeGoogle(config.model, req);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

async function completeAnthropic(
  model: string,
  { system, prompt }: CompletionRequest
): Promise<CompletionResult> {
  const AnthropicModule = await import("@anthropic-ai/sdk");
  const Anthropic = AnthropicModule.default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Extract<(typeof msg.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    text,
    tokensIn: msg.usage.input_tokens,
    tokensOut: msg.usage.output_tokens,
  };
}

async function completeOpenAI(
  model: string,
  { system, prompt }: CompletionRequest
): Promise<CompletionResult> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  return {
    text: res.choices[0]?.message?.content ?? "",
    tokensIn: res.usage?.prompt_tokens ?? 0,
    tokensOut: res.usage?.completion_tokens ?? 0,
  };
}

async function completeGoogle(
  model: string,
  { system, prompt }: CompletionRequest
): Promise<CompletionResult> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const genModel = client.getGenerativeModel({ model, systemInstruction: system });

  const res = await genModel.generateContent(prompt);
  const usage = res.response.usageMetadata;

  return {
    text: res.response.text(),
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: usage?.candidatesTokenCount ?? 0,
  };
}
