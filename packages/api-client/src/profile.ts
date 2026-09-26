import { NexusClient } from "./config";

// src/profile.ts — /api/me/* and /api/config endpoints (profile fields,
// onboarding flag, public client config).

export interface DisplayNameResponse {
  displayName: string | null;
  needsDisplayName?: boolean;
}

export async function getDisplayName(
  client: NexusClient
): Promise<DisplayNameResponse> {
  return client.expect<DisplayNameResponse>("GET", "/api/me/display-name");
}

export async function saveDisplayName(
  client: NexusClient,
  displayName: string
): Promise<DisplayNameResponse> {
  return client.expect<DisplayNameResponse>("PATCH", "/api/me/display-name", {
    displayName,
  });
}

export async function getOnboarding(
  client: NexusClient
): Promise<{ completed: boolean }> {
  return client.expect<{ completed: boolean }>("GET", "/api/me/onboarding");
}

export async function completeOnboarding(
  client: NexusClient
): Promise<void> {
  await client.expect("PATCH", "/api/me/onboarding", { completed: true });
}

export async function getConfig(client: NexusClient): Promise<unknown> {
  return client.expect("GET", "/api/config");
}
