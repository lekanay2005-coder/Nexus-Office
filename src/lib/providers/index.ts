export interface CompletionRequest {
  system: string;
  prompt: string;
}

export interface CompletionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  // Set only by the Codebuff agent path: the role's structured output
  // payload (e.g. the strategist's routing decision, Ops' memory update).
  // The plain provider path parses fenced blocks instead.
  structured?: Record<string, unknown> | null;
}

export type ProviderName = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  // One of the built-in ProviderNames, or the name of a project-level
  // ai_provider integration (see the `integrations` table) for anything
  // else — resolved as a generic OpenAI-compatible chat completions call.
  provider: string;
  model: string;
  // User-supplied key from the Model Router settings (api_keys table) or
  // from an integrations row, decrypted just before the call. Falls back
  // to the server env var for the matching built-in provider when omitted.
  apiKey?: string;
  // Required when `provider` is a custom integration name.
  baseUrl?: string;
}

// Default provider/model for any role without an explicit role_models row.
// Set to whichever provider actually has a server-side API key configured;
// the Model Router lets the user override this per-role per-project.
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "google",
  model: "gemini-3.6-flash",
};

// A CompletionResult with no structured payload (plain provider path).
export function plainResult(result: Omit<CompletionResult, "structured">): CompletionResult {
  return { ...result, structured: null };
}

// Shared resilience policy (patterns borrowed from the Codebuff runtime:
// bounded retries with exponential backoff and a hard wall-clock timeout so
// a wedged provider call can't stall a pipeline run forever).
const COMPLETE_TIMEOUT_MS = 120_000;
const COMPLETE_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("overloaded") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("529") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("network")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function completeWithResilience(
  config: ProviderConfig,
  req: CompletionRequest
): Promise<CompletionResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= COMPLETE_MAX_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(complete(config, req), COMPLETE_TIMEOUT_MS, config.provider);
    } catch (err) {
      lastError = err;
      if (attempt === COMPLETE_MAX_ATTEMPTS || !isRetryableError(err)) throw err;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, provider: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${provider} call timed out after ${ms / 1000}s`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Local/dev escape hatch: set NEXUS_MOCK_LLM=1 to run the full pipeline
// against canned, role-aware responses instead of calling a real provider.
// Lets us test routing, persistence, and the UI without API keys/spend.
const MOCK_LLM = process.env.NEXUS_MOCK_LLM === "1";

export async function complete(
  config: ProviderConfig,
  req: CompletionRequest
): Promise<CompletionResult> {
  const result = await completeInner(config, req);
  return { ...result, structured: null };
}

async function completeInner(
  config: ProviderConfig,
  req: CompletionRequest
): Promise<Omit<CompletionResult, "structured">> {
  if (MOCK_LLM) return completeMock(req);

  switch (config.provider) {
    case "anthropic":
      return completeAnthropic(config.model, config.apiKey, req);
    case "openai":
      return completeOpenAI(config.model, config.apiKey, req);
    case "google":
      return completeGoogle(config.model, config.apiKey, req);
    default:
      if (!config.baseUrl) {
        throw new Error(
          `Unknown provider "${config.provider}" and no base URL configured for it.`
        );
      }
      return completeCustom(config.baseUrl, config.apiKey, config.model, req);
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

async function completeMock({ system, prompt }: CompletionRequest): Promise<Omit<CompletionResult, "structured">> {
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
      const direction = `Here's a direct answer to: "${userMessage.trim()}". (This is a mocked Strategist response — no build work needed.)`;
      return `[mock] No build work needed for this one.\n\n\`\`\`strategist\n${JSON.stringify(
        { needs_full_pipeline: false, direction },
        null,
        2
      )}\n\`\`\``;
    }
    const direction =
      "Build a simple static landing page per the user's request. Builder should create an index.html with a heading and a short paragraph.";
    return `[mock] This needs real work — routing to the full pipeline.\n\n\`\`\`strategist\n${JSON.stringify(
      { needs_full_pipeline: true, direction },
      null,
      2
    )}\n\`\`\``;
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
    if (prompt.includes("BUILDER OUTPUT:")) {
      return `[mock] Built a static landing page with a heading and paragraph; Analyst flagged a missing viewport tag; QA suggested manual + lint checks.\n\n\`\`\`memory-update\n{\n  "decisions": ["Built an initial static landing page (index.html) per user request"],\n  "open_issues": ["Add a viewport meta tag to index.html"],\n  "tech_stack": ["Static HTML"]\n}\n\`\`\``;
    }
    const direction = prompt.match(/STRATEGIST DIRECTION:\n([\s\S]*?)(?:\n\n---|$)/)?.[1]?.trim();
    return `[mock] ${direction ?? "Here's the answer to your question."}`;
  }

  return "[mock] No matching role prompt detected.";
}

async function completeAnthropic(
  model: string,
  apiKey: string | undefined,
  { system, prompt }: CompletionRequest
): Promise<Omit<CompletionResult, "structured">> {
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
): Promise<Omit<CompletionResult, "structured">> {
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
): Promise<Omit<CompletionResult, "structured">> {
  // Key resolution order: per-user/integration key (Model Router / vault) →
  // GEMINI_API_KEY → legacy GOOGLE_API_KEY. Throwing a clear error when none
  // is set beats the SDK's vague "Could not resolve authentication method".
  const resolvedKey = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!resolvedKey) {
    throw new Error(
      "No Gemini API key configured. Set GEMINI_API_KEY on the server (or save a Google key in Model Router settings)."
    );
  }
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI(resolvedKey);
  const genModel = client.getGenerativeModel({ model, systemInstruction: system });

  const res = await genModel.generateContent(prompt);
  const usage = res.response.usageMetadata;

  return {
    text: res.response.text(),
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: usage?.candidatesTokenCount ?? 0,
  };
}

// Generic call for any project-level ai_provider integration — assumes an
// OpenAI-compatible /chat/completions endpoint, which covers OpenRouter,
// Together AI, and most other OpenAI-compatible gateways without needing
// provider-specific code.
async function completeCustom(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  { system, prompt }: CompletionRequest
): Promise<Omit<CompletionResult, "structured">> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Custom provider call to ${baseUrl} failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}
