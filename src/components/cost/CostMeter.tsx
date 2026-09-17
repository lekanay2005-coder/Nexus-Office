"use client";

import { useEffect, useState } from "react";
import { ROLES, type Role } from "@/types/db";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/pipeline/roles";
import { estimateCostUsd } from "@/lib/providers/catalog";

interface CostStep {
  run_id: string;
  role: Role;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

interface CostRun {
  id: string;
  user_message: string;
  mode: "pipeline" | "direct";
  created_at: string;
}

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;
}

export default function CostMeter({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<CostRun[]>([]);
  const [steps, setSteps] = useState<CostStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/cost`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load cost data");
    } else {
      setRuns(data.runs ?? []);
      setSteps(data.steps ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const totalTokensIn = steps.reduce((sum, s) => sum + (s.tokens_in ?? 0), 0);
  const totalTokensOut = steps.reduce((sum, s) => sum + (s.tokens_out ?? 0), 0);
  const totalCost = steps.reduce((sum, s) => {
    if (!s.model) return sum;
    return sum + (estimateCostUsd(s.model, s.tokens_in ?? 0, s.tokens_out ?? 0) ?? 0);
  }, 0);
  const hasUnknownPricing = steps.some(
    (s) => s.model && estimateCostUsd(s.model, 0, 0) === null
  );

  const byRole = ROLES.map((role) => {
    const roleSteps = steps.filter((s) => s.role === role);
    const tokensIn = roleSteps.reduce((sum, s) => sum + (s.tokens_in ?? 0), 0);
    const tokensOut = roleSteps.reduce((sum, s) => sum + (s.tokens_out ?? 0), 0);
    const cost = roleSteps.reduce((sum, s) => {
      if (!s.model) return sum;
      return sum + (estimateCostUsd(s.model, s.tokens_in ?? 0, s.tokens_out ?? 0) ?? 0);
    }, 0);
    return { role, tokensIn, tokensOut, cost, runs: roleSteps.length };
  });

  const runsById = new Map(runs.map((r) => [r.id, r]));
  const stepsByRun = new Map<string, CostStep[]>();
  for (const step of steps) {
    const list = stepsByRun.get(step.run_id) ?? [];
    list.push(step);
    stepsByRun.set(step.run_id, list);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-8 text-neutral-100">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="mb-1 text-lg font-semibold">Cost Meter</h2>
          <p className="text-sm text-neutral-500">
            Token usage and estimated spend across every pipeline run in this project.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}

      {!loading && (
        <>
          <section className="grid grid-cols-3 gap-3">
            <StatCard label="Total tokens in" value={totalTokensIn.toLocaleString()} />
            <StatCard label="Total tokens out" value={totalTokensOut.toLocaleString()} />
            <StatCard label="Estimated cost" value={formatUsd(totalCost)} />
          </section>
          {hasUnknownPricing && (
            <p className="text-xs text-neutral-600">
              Some steps used a model without known pricing — their cost isn&apos;t
              included in the estimate above.
            </p>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-400">By Role</h3>
            <div className="space-y-1.5">
              {byRole.map(({ role, tokensIn, tokensOut, cost, runs: runCount }) => (
                <div
                  key={role}
                  className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: ROLE_COLORS[role] }}
                  >
                    {ROLE_LABELS[role][0]}
                  </span>
                  <span className="w-20 shrink-0">{ROLE_LABELS[role]}</span>
                  <span className="flex-1 text-xs text-neutral-500">
                    {runCount} call{runCount === 1 ? "" : "s"} · {tokensIn.toLocaleString()} in /{" "}
                    {tokensOut.toLocaleString()} out
                  </span>
                  <span className="shrink-0 font-medium">{formatUsd(cost)}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-400">By Run</h3>
            <ul className="space-y-2">
              {runs.map((run) => {
                const runSteps = stepsByRun.get(run.id) ?? [];
                const runCost = runSteps.reduce((sum, s) => {
                  if (!s.model) return sum;
                  return sum + (estimateCostUsd(s.model, s.tokens_in ?? 0, s.tokens_out ?? 0) ?? 0);
                }, 0);
                return (
                  <li
                    key={run.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm text-neutral-200">
                        {run.user_message}
                      </p>
                      <span className="shrink-0 text-xs font-medium text-neutral-400">
                        {formatUsd(runCost)}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-600">
                      {run.mode} · {new Date(run.created_at).toLocaleString()}
                    </p>
                  </li>
                );
              })}
              {runs.length === 0 && !runsById.size && (
                <li className="text-sm text-neutral-500">No pipeline runs yet.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
