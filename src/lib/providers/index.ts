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
  // User-supplied key from the Model Router settings (api_keys table),
  // decrypted just before the call. Falls back to the server env var
  // for the matching provider when omitted.
  apiKey?: string;
}

// MVP default: every role runs on Claude. The Model Router (v2) will let
// the user override this per-role via the role_models table.
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
};

// Local/dev escape hatch: set NEXUS_MOCK_LLM=1 to run the full pipeline
// against canned, role-aware responses instead of calling a real provider.
// Lets us test routing, persistence, and the UI without API keys/spend.
const MOCK_LLM = process.env.NEXUS_MOCK_LLM === "1";

export async function complete(
  config: ProviderConfig,
  req: CompletionRequest
): Promise<CompletionResult> {
  if (MOCK_LLM) return completeMock(req);

  switch (config.provider) {
    case "anthropic":
      return completeAnthropic(config.model, config.apiKey, req);
    case "openai":
      return completeOpenAI(config.model, config.apiKey, req);
    case "google":
      return completeGoogle(config.model, config.apiKey, req);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

const BUILD_KEYWORDS = [
  "build",
  "create",
  "add",
  "implement",
  "fix",
  "write",
  "refactor",
  "update",
  "change",
  "make",
];

async function completeMock({ system, prompt }: CompletionRequest): Promise<CompletionResult> {
  const text = mockResponseFor(system, prompt);
  return {
    text,
    tokensIn: Math.ceil((system.length + prompt.length) / 4),
    tokensOut: Math.ceil(text.length / 4),
  };
}

function mockResponseFor(system: string, prompt: string): string {
  if (system.includes("You are the Strategist")) {
    const userMessage = (prompt.match(/USER MESSAGE:\n([\s\S]*)/)?.[1] ?? prompt).toLowerCase();
    const isBuildRequest = BUILD_KEYWORDS.some((kw) => userMessage.includes(kw));

    if (!isBuildRequest) {
      return `ROUTE: DIRECT\n[mock] Here's a direct answer to: "${userMessage.trim()}". (This is a mocked Strategist response — no build work needed.)`;
    }
    return `ROUTE: PIPELINE\n[mock] Plan: build a simple static landing page per the user's request. Builder should create an index.html with a heading and a short paragraph.`;
  }

  if (system.includes("You are the Builder")) {
    return `[mock] Implemented the plan.\n\n\`\`\`path=index.html\n<!doctype html>\n<html>\n  <head><title>Mock Page</title></head>\n  <body>\n    <h1>Hello from Nexus Office</h1>\n    <p>This page was written by the mocked Builder role.</p>\n  </body>\n</html>\n\`\`\``;
  }

  if (system.includes("You are the Analyst")) {
    return `[mock] Reviewed the Builder's output: the markup is valid and self-contained. No external dependencies, so no compatibility risk. Consider adding a viewport meta tag before shipping.`;
  }

  if (system.includes("You are QA")) {
    return `[mock] Suggested checks: (1) open index.html in a browser and confirm the heading renders, (2) validate HTML via a linter, (3) check mobile viewport once a meta tag is added.`;
  }

  if (system.includes("You are Ops")) {
    return `[mock] Summary: built a static landing page with a heading and paragraph; Analyst flagged a missing viewport tag; QA suggested manual + lint checks.\n\n\`\`\`memory-update\n{\n  "decisions": ["Built an initial static landing page (index.html) per user request"],\n  "open_issues": ["Add a viewport meta tag to index.html"],\n  "tech_stack": ["Static HTML"]\n}\n\`\`\``;
  }

  return "[mock] No matching role prompt detected.";
}

async function completeAnthropic(
  model: string,
  apiKey: string | undefined,
  { system, prompt }: CompletionRequest
): Promise<CompletionResult> {
  const AnthropicModule = await import("@anthropic-ai/sdk");
  const Anthropic = AnthropicModule.default;
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

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
  apiKey: string | undefined,
  { system, prompt }: CompletionRequest
): Promise<CompletionResult> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });

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
  apiKey: string | undefined,
  { system, prompt }: CompletionRequest
): Promise<CompletionResult> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI((apiKey ?? process.env.GOOGLE_API_KEY)!);
  const genModel = client.getGenerativeModel({ model, systemInstruction: system });

  const res = await genModel.generateContent(prompt);
  const usage = res.response.usageMetadata;

  return {
    text: res.response.text(),
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: usage?.candidatesTokenCount ?? 0,
  };
}
