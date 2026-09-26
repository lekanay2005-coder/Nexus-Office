import { NexusClient } from "./config";

// src/explore.ts — the public World Board (Addendum 13 section 4).

export interface ExplorePrompt {
  prompt_id: string;
  author_display_name: string;
  author_avatar_url: string | null;
  title: string;
  body: string;
  tags: string[];
  updated_at: string;
  preview: string;
}

export async function listExplorePrompts(
  client: NexusClient,
  filters?: { q?: string; tag?: string }
): Promise<{ prompts: ExplorePrompt[]; allTags: string[] }> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.tag) params.set("tag", filters.tag);
  const qs = params.toString();
  const data = await client.expect<{ prompts: ExplorePrompt[]; allTags: string[] }>(
    "GET",
    `/api/explore${qs ? `?${qs}` : ""}`
  );
  return { prompts: data.prompts ?? [], allTags: data.allTags ?? [] };
}

/** Anonymous-friendly report/flag for moderation review. */
export async function reportExplorePrompt(
  client: NexusClient,
  promptId: string,
  reason: string
): Promise<void> {
  await client.expect("POST", "/api/explore", { promptId, reason });
}
