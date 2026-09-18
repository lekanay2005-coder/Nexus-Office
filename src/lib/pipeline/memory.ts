import type { ProjectMemory } from "@/types/db";

export function formatMemoryForPrompt(memory: ProjectMemory): string {
  const stack = memory.tech_stack.length
    ? memory.tech_stack.join(", ")
    : "(none recorded yet)";

  const decisions = memory.decisions.length
    ? memory.decisions.slice(-20).map((d) => `- ${d.text}`).join("\n")
    : "(none yet)";

  const issues = memory.open_issues
    .filter((i) => i.status === "open")
    .map((i) => `- ${i.text}`)
    .join("\n") || "(none)";

  return `PROJECT MEMORY
Tech stack: ${stack}

Summary: ${memory.summary || "(no summary yet)"}

Recent decisions:
${decisions}

Open issues:
${issues}`;
}

export interface MemoryUpdate {
  decisions?: string[];
  open_issues?: string[];
  tech_stack?: string[];
}

const MEMORY_BLOCK_RE = /```memory-update\s*([\s\S]*?)```/;

export function extractMemoryUpdate(opsOutput: string): MemoryUpdate | null {
  const match = opsOutput.match(MEMORY_BLOCK_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed as MemoryUpdate;
  } catch {
    return null;
  }
}

export function stripMemoryBlock(opsOutput: string): string {
  return opsOutput.replace(MEMORY_BLOCK_RE, "").trim();
}

export interface StrategistDecision {
  needsFullPipeline: boolean;
  direction: string;
}

const STRATEGIST_BLOCK_RE = /```strategist\s*([\s\S]*?)```/;

// Falls back to treating the whole reply as "needs full pipeline" if the
// model didn't emit a parseable block, so a malformed response degrades to
// the safer (more thorough) path rather than silently short-circuiting.
export function parseStrategistOutput(strategistOutput: string): StrategistDecision {
  const match = strategistOutput.match(STRATEGIST_BLOCK_RE);
  if (!match) {
    return { needsFullPipeline: true, direction: strategistOutput.trim() };
  }
  try {
    const parsed = JSON.parse(match[1].trim());
    return {
      needsFullPipeline: Boolean(parsed.needs_full_pipeline),
      direction: typeof parsed.direction === "string" ? parsed.direction : strategistOutput.trim(),
    };
  } catch {
    return { needsFullPipeline: true, direction: strategistOutput.trim() };
  }
}

export function stripStrategistBlock(strategistOutput: string): string {
  return strategistOutput.replace(STRATEGIST_BLOCK_RE, "").trim();
}
