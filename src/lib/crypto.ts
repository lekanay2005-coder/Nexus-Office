import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// User-supplied provider API keys (api_keys table) are encrypted at rest
// with this server-only secret so a DB leak doesn't leak plaintext keys.
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
function getKey(): Buffer {
  const b64 = process.env.NEXUS_ENCRYPTION_KEY;
  if (!b64) throw new Error("NEXUS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("NEXUS_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(".");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
