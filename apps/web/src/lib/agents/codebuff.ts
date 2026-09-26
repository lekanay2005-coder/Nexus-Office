import { z } from "zod";
import {
  CodebuffClient,
  getCustomToolDefinition,
  type AgentDefinition,
} from "@codebuff/sdk";
import type { Role } from "@/types/db";
import { assertRoleAllowed } from "@/lib/capabilities";
import type { SupabaseClient } from "@supabase/supabase-js";

// This module bridges Nexus Office's 5-role pipeline to the Codebuff agent
// runtime (the same open framework that powers Freebuff). Each Nexus role
// becomes a structured-output Codebuff agent, so roles can be stepped one at
// a time by our orchestrator while still getting agent-grade prompting,
// context handling, and model routing from the SDK.

/**
 * Structured result every role agent returns to the orchestrator. Using the
 * SDK's `outputMode: "structured_output"` (instead of parsing fenced blocks)
 * means malformed outputs surface as errors rather than silently corrupting
 * the pipeline.
 */
export interface RoleAgentResult {
  /** The user-facing markdown for this role's card in the chat UI. */
  text: string;
  /** Structured payload, shape depends on the role (see schemas below). */
  data: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
}

// --- Structured output schemas (mirrors lib/pipeline/memory.ts parsing) ----

type OutputSchema = NonNullable<AgentDefinition["outputSchema"]>;

const STRATEGIST_OUTPUT_SCHEMA: OutputSchema = {
  type: "object" as const,
  properties: {
    text: { type: "string", description: "Short reply shown to the user summarizing the routing decision." },
    needs_full_pipeline: {
      type: "boolean",
      description: "True when real build/change/review work is required; false for direct questions.",
    },
    direction: {
      type: "string",
      description: "For direct answers: the actual answer content for Ops. For pipeline runs: the build plan for the Builder.",
    },
  },
  required: ["text", "needs_full_pipeline", "direction"],
};

const BUILDER_OUTPUT_SCHEMA: OutputSchema = {
  type: "object" as const,
  properties: {
    text: { type: "string", description: "Concrete implementation output: code, file contents, or specific technical steps. Use ```path=<file> fenced blocks for whole files." },
  },
  required: ["text"],
};

const ANALYST_OUTPUT_SCHEMA: OutputSchema = {
  type: "object" as const,
  properties: {
    text: { type: "string", description: "Concise review of the Builder's output: correctness, edge cases, risks. Reference, don't repeat, the Builder's work." },
  },
  required: ["text"],
};

const QA_OUTPUT_SCHEMA: OutputSchema = {
  type: "object" as const,
  properties: {
    text: { type: "string", description: "Specific, actionable test plan and any bugs spotted by inspection." },
  },
  required: ["text"],
};

const OPS_OUTPUT_SCHEMA: OutputSchema = {
  type: "object" as const,
  properties: {
    text: { type: "string", description: "The complete final user-facing answer for this turn — write it in full, don't describe it." },
    decisions: { type: "array", items: { type: "string" }, description: "Short statements of decisions made this turn. Empty array if none." },
    open_issues: { type: "array", items: { type: "string" }, description: "Short statements of new open issues. Empty array if none." },
    tech_stack: { type: "array", items: { type: "string" }, description: "New tech/libraries introduced this turn. Empty array if none." },
  },
  required: ["text", "decisions", "open_issues", "tech_stack"],
};

/**
 * Agent definitions for the five Nexus roles, converted from the role system
 * prompts (lib/pipeline/roles.ts) so both execution paths stay in sync.
 * `windowedFileReads` opts into the SDK's search-first, windowed file reading.
 */
export function buildRoleAgentDefinitions(): Record<Role, AgentDefinition> {
  return {
    strategist: {
      id: "nexus-strategist",
      displayName: "Strategist",
      model: "google/gemini-2.5-flash",
      outputMode: "structured_output",
      outputSchema: STRATEGIST_OUTPUT_SCHEMA,
      toolNames: ["project_read_file"],
      spawnerPrompt:
        "Routes a user message for a 5-person AI dev team: answers simple questions directly or plans real build work.",
      instructionsPrompt: `You are the Strategist on a 5-person AI dev team inside Nexus Office.
Read the conversation below, then decide how to respond.

Set "needs_full_pipeline" to false for simple one-off questions, clarifications, or
anything that doesn't require building/changing the project. In that case put the
actual answer content in "direction" — Ops will show it to the user as-is.

Set "needs_full_pipeline" to true for anything that requires building, changing,
reviewing, or planning real work on the project. In that case "direction" is a short
plan for the Builder: what to build/change and why. Reference the project's tech
stack, decisions, and open issues when they matter.

If a file's contents are needed to answer well, call the project_read_file tool.
Write the user-visible summary of your decision in "text".`,
    },
    builder: {
      id: "nexus-builder",
      displayName: "Builder",
      model: "google/gemini-2.5-flash",
      outputMode: "structured_output",
      outputSchema: BUILDER_OUTPUT_SCHEMA,
      toolNames: ["project_read_file"],
      spawnerPrompt:
        "Implements a plan for a project: produces code and complete file contents.",
      instructionsPrompt: `You are the Builder on a 5-person AI dev team inside Nexus Office.
You receive the project's memory and the Strategist's plan. Produce concrete
implementation output in "text": code, file contents, or specific technical steps.

When producing a file intended for the project's file tree, embed it in "text" as a
fenced code block with the file path on the info line, like:

\`\`\`path=src/app/page.tsx
...file contents...
\`\`\`

Be concrete and complete — execute the plan, don't restate it. Use project_read_file
to inspect existing files before changing them.`,
    },
    analyst: {
      id: "nexus-analyst",
      displayName: "Analyst",
      model: "google/gemini-2.5-flash",
      outputMode: "structured_output",
      outputSchema: ANALYST_OUTPUT_SCHEMA,
      toolNames: ["project_read_file"],
      spawnerPrompt:
        "Reviews a Builder's implementation for correctness, edge cases, and risk.",
      instructionsPrompt: `You are the Analyst on a 5-person AI dev team inside Nexus Office.
Review the Builder's work for correctness, edge cases, and alignment with the
project's tech stack and prior decisions. Flag risks or gaps concisely in "text".
Do not repeat the Builder's full output back; reference it. Use project_read_file to
check the current state of any file you need to evaluate the changes against.`,
    },
    qa: {
      id: "nexus-qa",
      displayName: "QA",
      model: "google/gemini-2.5-flash",
      outputMode: "structured_output",
      outputSchema: QA_OUTPUT_SCHEMA,
      toolNames: ["project_read_file"],
      spawnerPrompt:
        "Designs tests and manual checks for a change and spots bugs by inspection.",
      instructionsPrompt: `You are QA on a 5-person AI dev team inside Nexus Office.
Identify what tests or manual checks should be run, and call out any bugs or missing
coverage you can spot by inspection. Be specific and actionable in "text". Use
project_read_file to read the current files when the change references them.`,
    },
    ops: {
      id: "nexus-ops",
      displayName: "Ops",
      model: "google/gemini-2.5-flash",
      outputMode: "structured_output",
      outputSchema: OPS_OUTPUT_SCHEMA,
      spawnerPrompt:
        "Writes the final user-facing answer and extracts durable memory updates.",
      instructionsPrompt: `You are Ops on a 5-person AI dev team inside Nexus Office. You run last and
you always write the final, user-facing answer for this turn — a direct answer to a
simple question (using the Strategist's direction) or a summary of a full build
(plan, build, analysis, QA). Write it in full in "text" — don't describe it.

Then extract genuinely new persistent facts for the project's memory:
- "decisions": choices made this turn (one short sentence each)
- "open_issues": new open issues (one short sentence each)
- "tech_stack": new tech/libraries introduced this turn

Only include new information, not restatements of existing memory. Use empty
arrays when there is nothing new.`,
    },
  };
}

// --- Sandboxed project-file tool -------------------------------------------

/**
 * Custom tool the role agents use to read files from the project's `files`
 * table (the Code Canvas tree) — not the host filesystem. Enforces the role's
 * `read_files` capability server-side on every call, mirroring the
 * least-privilege model in lib/capabilities.ts.
 */
export function buildProjectReadFileTool(options: {
  supabase: SupabaseClient;
  projectId: string;
  role: Role;
  /** Populated with a denial notice when the role lacks read_files. */
  deniedRef?: { denied: boolean };
}) {
  const { supabase, projectId, role, deniedRef } = options;
  return getCustomToolDefinition<"project_read_file", { path: string }, unknown>({
    toolName: "project_read_file",
    description:
      "Read one file from this project's file tree. Returns the file's contents, or an error if the path doesn't exist.",
    inputSchema: z.object({
      path: z.string().describe("Path of the file within the project, e.g. src/app/page.tsx"),
    }) as z.ZodType<{ path: string }, unknown>,
    exampleInputs: [{ path: "src/app/page.tsx" }],
    execute: async ({ path }) => {
      const allowed = await assertRoleAllowed(supabase, projectId, role, "read_files");
      if (!allowed) {
        if (deniedRef) deniedRef.denied = true;
        return [
          {
            type: "json" as const,
            value: {
              error: `The ${role} role does not have the read_files capability for this project. Continue without reading files.`,
            },
          },
        ];
      }
      const { data, error } = await supabase
        .from("files")
        .select("content")
        .eq("project_id", projectId)
        .eq("path", path)
        .maybeSingle();
      if (error) {
        return [{ type: "json" as const, value: { error: `Failed to read file: ${error.message}` } }];
      }
      if (!data) {
        return [{ type: "json" as const, value: { error: `No file found at path: ${path}` } }];
      }
      return [{ type: "json" as const, value: { path, content: data.content } }];
    },
  });
}

// --- Runner ----------------------------------------------------------------

export interface RunRoleAgentOptions {
  role: Role;
  /** Full prompt for this role: memory + user message + prior role outputs. */
  prompt: string;
  codebuffApiKey: string;
  projectFiles?: Record<string, string>;
  supabase: SupabaseClient;
  projectId: string;
  /** Stream progress events to the client (tool calls, subagent activity). */
  onEvent?: (event: { type: string; message: string }) => void;
  /** Hard deadline for the whole agent run (ms). Default 4 minutes. */
  timeoutMs?: number;
  maxAgentSteps?: number;
  /** Populated when the role's file reads were denied by capability checks. */
  onCapabilityDenied?: () => void;
}

export async function runRoleAgent(options: RunRoleAgentOptions): Promise<RoleAgentResult> {
  const {
    role,
    prompt,
    codebuffApiKey,
    projectFiles,
    supabase,
    projectId,
    onEvent,
    timeoutMs = 240_000,
    maxAgentSteps = 8,
    onCapabilityDenied,
  } = options;

  const agentDefinitions = buildRoleAgentDefinitions();
  const deniedRef = { denied: false };
  const readTool = buildProjectReadFileTool({ supabase, projectId, role, deniedRef });

  const client = new CodebuffClient({ apiKey: codebuffApiKey, cwd: process.cwd() });

  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  let runState;
  try {
    runState = await client.run({
      agent: agentDefinitions[role],
      prompt,
      projectFiles,
      agentDefinitions: Object.values(agentDefinitions),
      customToolDefinitions: [readTool],
      maxAgentSteps,
      handleEvent: (event) => {
        if (!onEvent) return;
        if (event.type === "tool_call") {
          onEvent({
            type: "tool_call",
            message: `${role} → ${event.toolName}${event.input?.path ? `(${event.input.path})` : ""}`,
          });
        } else if (event.type === "error") {
          onEvent({ type: "error", message: event.message });
        }
      },
      signal: timeoutSignal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Codebuff ${role} agent run failed: ${message}`);
  }

  const output = runState.output;
  if (output.type === "error") {
    throw new Error(`Codebuff ${role} agent error: ${output.message}`);
  }
  if (output.type !== "structuredOutput" || !output.value) {
    throw new Error(
      `Codebuff ${role} agent returned no structured output (got type "${output.type}").`
    );
  }

  if (deniedRef.denied) onCapabilityDenied?.();

  const value = output.value as Record<string, unknown>;
  const mainState = (
    runState.sessionState as { mainAgentState?: { contextTokenCount?: number } } | undefined
  )?.mainAgentState;
  // Context occupancy isn't billed usage, but it's the best signal the SDK
  // exposes for the Cost Meter; real receipts arrive via onUsage on newer
  // runtimes and would replace this.
  const tokensIn = Number(mainState?.contextTokenCount ?? 0) || 0;
  const tokensOut = estimateTokens(JSON.stringify(value));

  return {
    text: typeof value.text === "string" ? value.text : JSON.stringify(value),
    data: value,
    tokensIn,
    tokensOut,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** True when the role was routed through the Codebuff runtime. */
export function isCodebuffProvider(provider: string): boolean {
  return provider === "codebuff";
}
