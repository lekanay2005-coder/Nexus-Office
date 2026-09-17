import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";

export async function getDecryptedApiKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string
): Promise<string | null> {
  const { data } = await supabase
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) return null;
  try {
    return decryptSecret(data.encrypted_key);
  } catch {
    return null;
  }
}
