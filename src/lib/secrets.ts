import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// Dedicated secrets vault (Addendum 3). Every API key / token the app
// stores goes through here instead of being written straight into an
// encrypted column. Values are AES-256-GCM encrypted (see lib/crypto)
// and never leave the server unencrypted.
//
// Key-name conventions:
//   user secrets:    user:{userId}:key:{provider}      (provider = github, anthropic, vercel, …)
//   project secrets: project:{projectId}:integration:{name}:api_key
//
// Legacy rows (pre-vault) keep their encrypted value in the old columns.
// Reads fall back to those and copy the value into the vault, so every
// key migrates on next save or next read — no user-facing change.

export type SecretOwnerType = "user" | "project";

export interface SecretRef {
  ownerType: SecretOwnerType;
  ownerId: string;
  keyName: string;
}

export function userSecretRef(userId: string, keyName: string): SecretRef {
  return { ownerType: "user", ownerId: userId, keyName };
}

export function projectSecretRef(projectId: string, keyName: string): SecretRef {
  return { ownerType: "project", ownerId: projectId, keyName };
}

export async function setSecret(
  supabase: SupabaseClient,
  ref: SecretRef,
  plaintext: string
): Promise<void> {
  const { error } = await supabase.from("secrets").upsert(
    {
      owner_type: ref.ownerType,
      owner_id: ref.ownerId,
      key_name: ref.keyName,
      encrypted_value: encryptSecret(plaintext),
    },
    { onConflict: "owner_type,owner_id,key_name" }
  );
  if (error) throw new Error(`Failed to store secret: ${error.message}`);
}

export async function deleteSecret(supabase: SupabaseClient, ref: SecretRef): Promise<void> {
  const { error } = await supabase.from("secrets").delete().match({
    owner_type: ref.ownerType,
    owner_id: ref.ownerId,
    key_name: ref.keyName,
  });
  if (error) throw new Error(`Failed to delete secret: ${error.message}`);
}

// Returns the decrypted secret, or null if absent / undecryptable.
export async function getSecret(
  supabase: SupabaseClient,
  ref: SecretRef
): Promise<string | null> {
  const { data, error } = await supabase
    .from("secrets")
    .select("encrypted_value")
    .match({ owner_type: ref.ownerType, owner_id: ref.ownerId, key_name: ref.keyName })
    .maybeSingle();

  if (error || !data) return null;
  try {
    return decryptSecret(data.encrypted_value);
  } catch {
    return null;
  }
}

// Vault read with a legacy-column fallback that migrates into the vault
// on success. `readLegacy` returns the plaintext from the old storage (or
// null); it is only called when the vault has no entry.
export async function getSecretWithLegacy(
  supabase: SupabaseClient,
  ref: SecretRef,
  readLegacy: () => Promise<string | null>
): Promise<string | null> {
  const fromVault = await getSecret(supabase, ref);
  if (fromVault !== null) return fromVault;

  const legacy = await readLegacy();
  if (legacy === null) return null;

  // Migration-on-read: copy into the vault. Best-effort — if the secrets
  // table isn't migrated yet, the legacy value still works.
  try {
    await setSecret(supabase, ref, legacy);
  } catch {
    // ignore — legacy value remains usable
  }
  return legacy;
}

// ---------- App-specific convenience wrappers ----------

export async function getUserProviderKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string
): Promise<string | null> {
  return getSecretWithLegacy(supabase, userSecretRef(userId, `key:${provider}`), async () => {
    const { data } = await supabase
      .from("api_keys")
      .select("encrypted_key")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (!data?.encrypted_key) return null;
    try {
      return decryptSecret(data.encrypted_key);
    } catch {
      return null;
    }
  });
}

export async function setUserProviderKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  plaintext: string
): Promise<void> {
  await setSecret(supabase, userSecretRef(userId, `key:${provider}`), plaintext);
}

export async function deleteUserProviderKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string
): Promise<void> {
  await deleteSecret(supabase, userSecretRef(userId, `key:${provider}`));
}

export async function getIntegrationApiKey(
  supabase: SupabaseClient,
  projectId: string,
  integrationName: string,
  legacyEncrypted: string | null | undefined
): Promise<string | null> {
  return getSecretWithLegacy(
    supabase,
    projectSecretRef(projectId, `integration:${integrationName}:api_key`),
    async () => {
      if (!legacyEncrypted) return null;
      try {
        return decryptSecret(legacyEncrypted);
      } catch {
        return null;
      }
    }
  );
}

export async function setIntegrationApiKey(
  supabase: SupabaseClient,
  projectId: string,
  integrationName: string,
  plaintext: string
): Promise<void> {
  await setSecret(
    supabase,
    projectSecretRef(projectId, `integration:${integrationName}:api_key`),
    plaintext
  );
}

export async function deleteIntegrationApiKey(
  supabase: SupabaseClient,
  projectId: string,
  integrationName: string
): Promise<void> {
  await deleteSecret(supabase, projectSecretRef(projectId, `integration:${integrationName}:api_key`));
}
