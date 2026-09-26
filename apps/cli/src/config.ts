import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Auth/config storage: a plain file at ~/.nexus/config (mode 600), same
// backend philosophy as similar CLI tools — never a database. Holds the
// Supabase access/refresh tokens obtained via `nexus login` and the base
// URL of the Nexus Office web app the CLI talks to.

export interface NexusConfig {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  email?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".nexus");
const CONFIG_FILE = path.join(CONFIG_DIR, "config");

export function defaultBaseUrl(): string {
  return process.env.NEXUS_BASE_URL ?? "http://localhost:3000";
}

export function loadConfig(): NexusConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<NexusConfig>;
    return { ...{ baseUrl: defaultBaseUrl() }, ...parsed, baseUrl: parsed.baseUrl ?? defaultBaseUrl() };
  } catch {
    return { baseUrl: defaultBaseUrl() };
  }
}

export function saveConfig(update: Partial<NexusConfig>): NexusConfig {
  const next = { ...loadConfig(), ...update };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

export function clearAuth(): void {
  const cfg = loadConfig();
  saveConfig({ accessToken: undefined, refreshToken: undefined, email: undefined });
  void cfg;
}
