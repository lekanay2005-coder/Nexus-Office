"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createNexusClient } from "@nexus-office/api-client";

const nexus = createNexusClient();

// Audit Log (Addendum 3): a filterable, searchable read-only timeline of
// every action in the project — pipeline steps per role, file writes,
// GitHub commits, deploys, key and permission changes, approvals.

interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const ACTORS = ["user", "strategist", "builder", "analyst", "qa", "ops", "system"] as const;

const ROLE_COLORS: Record<string, string> = {
  strategist: "var(--role-strategist)",
  builder: "var(--role-builder)",
  analyst: "var(--role-analyst)",
  qa: "var(--role-qa)",
  ops: "var(--role-ops)",
};

function actorColor(actor: string): string {
  if (actor === "user") return "var(--role-analyst)";
  if (actor === "system") return "text-neutral-500";
  return ROLE_COLORS[actor] ?? "var(--role-strategist)";
}

function actorLabel(actor: string, displayName?: string): string {
  // Addendum 9: user-triggered actions show the display name, not "User".
  if (actor === "user" && displayName) return displayName;
  return actor[0].toUpperCase() + actor.slice(1);
}

function formatAction(action: string): string {
  return action.replace(/[._]/g, " ");
}

function metadataChips(metadata: Record<string, unknown> | null): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const chips: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    let text: string | null;
    if (Array.isArray(value)) text = value.length ? `${key}: ${value.join(", ")}` : null;
    else if (value === null || value === undefined) text = null;
    else if (typeof value === "object") text = `${key}: ${JSON.stringify(value)}`;
    else text = `${key}: ${value}`;
    if (text) chips.push(text);
  }
  return chips;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

export default function AuditLog({
  projectId,
  displayName,
}: {
  projectId: string;
  displayName: string;
}) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ actor, action, q, from, to })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    try {
      const { status, data } = await nexus.client.request<{ events?: AuditEvent[]; error?: string }>(
        "GET",
        `/api/projects/${projectId}/audit${qs ? `?${qs}` : ""}`
      );
      if (status >= 400) {
        setError((data as { error?: string } | null)?.error ?? "Failed to load audit log");
        return;
      }
      setEvents((data as { events?: AuditEvent[] } | null)?.events ?? []);
    } catch {
      setError("Failed to load audit log");
    }
  }, [projectId, actor, action, q, from, to]);

  // Debounced reload when filters change. The fetch itself runs in the
  // timeout callback (async), never synchronously inside the effect body.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, events === null ? 0 : 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  let lastDay = "";
  const grouped: React.ReactNode[] = [];
  for (const event of events ?? []) {
    const day = new Date(event.created_at).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      grouped.push(
        <div key={`day-${day}`} className="pt-3 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
          {day}
        </div>
      );
    }
    const color = actorColor(event.actor);
    grouped.push(
      <div
        key={event.id}
        title={new Date(event.created_at).toLocaleString()}
        className="glass-panel flex items-start gap-3 rounded-lg px-3 py-2"
      >
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px 0 ${color}` }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold" style={{ color }}>
              {actorLabel(event.actor, displayName)}
            </span>
            <span className="text-xs text-neutral-200">{formatAction(event.action)}</span>
            {event.target && (
              <span className="truncate font-mono text-[11px] text-neutral-500">{event.target}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {metadataChips(event.metadata).map((chip, i) => (
              <span
                key={i}
                className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-neutral-400"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
        <time className="shrink-0 text-[11px] text-neutral-600" dateTime={event.created_at}>
          {timeAgo(event.created_at)}
        </time>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="mb-1 text-lg font-semibold">Audit Log</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Every action in this project, traceable — pipeline runs per role, file writes, commits,
        deploys, key and permission changes.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          aria-label="Filter by actor"
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
        >
          <option value="">All actors</option>
          {ACTORS.map((a) => (
            <option key={a} value={a}>
              {actorLabel(a)}
            </option>
          ))}
        </select>
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Action (e.g. pipeline, deploy)…"
          aria-label="Filter by action"
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search action or target…"
          aria-label="Search audit log"
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-500"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-500"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {events === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}

      {events !== null && events.length === 0 && (
        <p className="text-sm text-neutral-500">
          No matching events. Actions appear here as you use the office.
        </p>
      )}

      {events !== null && events.length > 0 && <div className="space-y-2">{grouped}</div>}
    </div>
  );
}
