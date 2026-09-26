import { NexusClient } from "./config";

// src/vault.ts — Prompt Vault CRUD over the /api/prompts routes.

export interface VaultPromptEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  visibility: "private" | "public";
  created_at?: string;
  updated_at?: string;
}

export async function listVaultPrompts(client: NexusClient): Promise<VaultPromptEntry[]> {
  const data = await client.expect<{ prompts: VaultPromptEntry[] }>("GET", "/api/prompts");
  return data.prompts ?? [];
}

export async function saveVaultPrompt(
  client: NexusClient,
  prompt: { title: string; body: string; tags?: string[]; visibility?: "private" | "public"; id?: string }
): Promise<VaultPromptEntry> {
  const path = prompt.id ? `/api/prompts/${prompt.id}` : "/api/prompts";
  const method = prompt.id ? "PATCH" : "POST";
  const data = await client.expect<{ prompt: VaultPromptEntry }>(method, path, {
    title: prompt.title,
    body: prompt.body,
    tags: prompt.tags ?? [],
    visibility: prompt.visibility ?? "private",
  });
  return data.prompt;
}

export async function setPromptVisibility(
  client: NexusClient,
  promptId: string,
  visibility: "private" | "public"
): Promise<VaultPromptEntry> {
  const data = await client.expect<{ prompt: VaultPromptEntry }>(
    "PATCH",
    `/api/prompts/${promptId}`,
    { visibility }
  );
  return data.prompt;
}

export async function deleteVaultPrompt(
  client: NexusClient,
  promptId: string
): Promise<void> {
  await client.expect("DELETE", `/api/prompts/${promptId}`);
}
