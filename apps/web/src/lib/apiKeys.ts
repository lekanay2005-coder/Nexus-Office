import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserProviderKey } from "@/lib/secrets";

// Reads a user-scoped provider key (github, vercel, anthropic, …) through
// the secrets vault. Legacy api_keys rows are transparently migrated into
// the vault on first read (see lib/secrets).
export async function getDecryptedApiKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string
): Promise<string | null> {
  return getUserProviderKey(supabase, userId, provider);
}
