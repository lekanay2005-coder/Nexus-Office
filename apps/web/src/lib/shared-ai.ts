import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

// Shared free-tier AI key (Addendum 12 Phase 3).
//
// Nexus Office ships one app-owned provider key (env: NEXUS_DEFAULT_AI_KEY)
// so a brand-new project can run the pipeline with zero setup. It is strictly
// server-side: the key never reaches the client, and usage is capped at the
// Free-tier monthly limit per user (NEXUS_FREE_MONTHLY_RUNS, default 50) plus
// a global daily cap across all free users (NEXUS_SHARED_DAILY_CAP) as abuse
// protection. Every shared-key run is written to the Audit Log.
//
// This key is deliberately separate from Pro's managed-credit balance: free
// users get a small capped allowance, Pro users either bring their own keys
// or draw on the (separately metered) Pro credit pool.

export const SHARED_PROVIDER = "nexus-shared";

export interface SharedKeyConfig {
  provider: string;
  model: string;
  apiKey: string;
}

export function isSharedProvider(provider: string): boolean {
  return provider === SHARED_PROVIDER;
}

// The shared key's ProviderConfig, or null when the server has none configured.
export function getSharedKeyConfig(): SharedKeyConfig | null {
  const apiKey = process.env.NEXUS_DEFAULT_AI_KEY;
  if (!apiKey) return null;
  return {
    provider: process.env.NEXUS_DEFAULT_AI_PROVIDER || "google",
    model: process.env.NEXUS_DEFAULT_AI_MODEL || "gemini-2.0-flash-lite",
    apiKey,
  };
}

// True when the user has their own key stored for a provider (api_keys row).
// Usage on a provider the user owns is never counted against shared limits.
export async function userOwnsProviderKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string
): Promise<boolean> {
  const { data } = await supabase
    .from("api_keys")
    .select("provider")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  return Boolean(data);
}

export interface UsageWindow {
  used: number;
  limit: number;
  resetAt: string;
}

function startOfMonthUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfTomorrowUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

function startOfUTCDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface UsageCounters {
  userThisPeriod: number;
  globalToday: number;
}

// Counts shared-key runs by reading audit_events. Shared-key runs are always
// audit-logged with action "shared_ai.run", so the audit log doubles as the
// usage ledger — no extra table or migration needed.
async function countSharedUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<UsageCounters> {
  const monthStart = startOfMonthUTC().toISOString();
  const dayStart = startOfUTCDay().toISOString();

  const [userRes, globalRes] = await Promise.all([
    supabase
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "shared_ai.run")
      .gte("created_at", monthStart),
    supabase
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "shared_ai.run")
      .gte("created_at", dayStart),
  ]);

  return {
    userThisPeriod: userRes.count ?? 0,
    globalToday: globalRes.count ?? 0,
  };
}

export function monthlyLimit(): number {
  const parsed = Number(process.env.NEXUS_FREE_MONTHLY_RUNS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function globalDailyCap(): number {
  const parsed = Number(process.env.NEXUS_SHARED_DAILY_CAP);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

export interface SharedUsageCheck {
  allowed: boolean;
  reason: "ok" | "user_limit" | "global_limit" | "no_key";
  used: number;
  limit: number;
  resetAt: string;
}

// Gate a pipeline run on the shared key. Checks both the per-user monthly
// cap and the global daily cap, and persists the run to the audit log when
// allowed. Call once per pipeline run (not per role).
export async function checkAndConsumeSharedRun(
  supabase: SupabaseClient,
  userId: string
): Promise<SharedUsageCheck> {
  const limit = monthlyLimit();
  const resetAt = startOfMonthUTC();
  resetAt.setUTCMonth(resetAt.getUTCMonth() + 1);

  if (!getSharedKeyConfig()) {
    return { allowed: false, reason: "no_key", used: 0, limit, resetAt: resetAt.toISOString() };
  }

  const { userThisPeriod, globalToday } = await countSharedUsage(supabase, userId);

  if (userThisPeriod >= limit) {
    return {
      allowed: false,
      reason: "user_limit",
      used: userThisPeriod,
      limit,
      resetAt: resetAt.toISOString(),
    };
  }

  const dailyCap = globalDailyCap();
  if (globalToday >= dailyCap) {
    // Unusual-spike signal: the global cap tripping is worth a log line.
    console.warn(
      `[shared-ai] global daily cap reached (${globalToday}/${dailyCap}) — investigate possible abuse`
    );
    return {
      allowed: false,
      reason: "global_limit",
      used: globalToday,
      limit: dailyCap,
      resetAt: startOfTomorrowUTC().toISOString(),
    };
  }

  // Consume: the run itself is the ledger entry. Metadata carries no prompt
  // content — just enough to attribute usage.
  await logAudit(supabase, {
    projectId: "",
    userId,
    actor: "system",
    action: "shared_ai.run",
    target: null,
    metadata: { userCount: userThisPeriod + 1, globalCount: globalToday + 1 },
  });

  return {
    allowed: true,
    reason: "ok",
    used: userThisPeriod + 1,
    limit,
    resetAt: resetAt.toISOString(),
  };
}

// Read-only check for UI badges (does not consume a run).
export async function getSharedUsageSummary(
  supabase: SupabaseClient,
  userId: string
): Promise<{ usingShared: boolean; used: number; limit: number; resetAt: string } | null> {
  const config = getSharedKeyConfig();
  if (!config) return null;
  const { userThisPeriod } = await countSharedUsage(supabase, userId);
  const resetAt = startOfMonthUTC();
  resetAt.setUTCMonth(resetAt.getUTCMonth() + 1);
  return {
    usingShared: true,
    used: userThisPeriod,
    limit: monthlyLimit(),
    resetAt: resetAt.toISOString(),
  };
}
