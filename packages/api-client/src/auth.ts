import { NexusClient } from "./config";

// src/auth.ts — thin wrappers over the session/identity endpoints. The web
// app authenticates with Supabase cookies; the CLI sends its stored Bearer
// token (see apps/cli/src/auth.ts). Both go through the same endpoints.

export interface SessionInfo {
  displayName: string | null;
  avatarUrl: string | null;
  authenticated: boolean;
}

export async function getSession(client: NexusClient): Promise<SessionInfo> {
  const { status, data } = await client.request<{
    display_name?: string | null;
    avatar_url?: string | null;
  }>("GET", "/api/me/display-name");
  if (status === 401) {
    return { displayName: null, avatarUrl: null, authenticated: false };
  }
  if (status >= 400) {
    throw new Error(`Session check failed (${status})`);
  }
  return {
    displayName: data?.display_name ?? null,
    avatarUrl: data?.avatar_url ?? null,
    authenticated: true,
  };
}

/** Providers with a stored key (never returns key material). */
export async function listApiKeys(
  client: NexusClient
): Promise<{ provider: string; created_at: string }[]> {
  const data = await client.expect<{ apiKeys: { provider: string; created_at: string }[] }>(
    "GET",
    "/api/settings/api-keys"
  );
  return data.apiKeys ?? [];
}

export async function saveApiKey(
  client: NexusClient,
  provider: string,
  key: string
): Promise<void> {
  await client.expect("PUT", "/api/settings/api-keys", { provider, key });
}

export async function deleteApiKey(
  client: NexusClient,
  provider: string
): Promise<void> {
  await client.expect("DELETE", "/api/settings/api-keys", { provider });
}
