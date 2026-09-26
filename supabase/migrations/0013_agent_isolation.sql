-- ============================================================
-- Addendum 17 — Agent isolation (anti-spoilage).
-- Every pipeline run that writes files is isolated in a per-run
-- snapshot ("branch"): Builder's writes land in run_snapshots,
-- never directly in the files table, until scope enforcement
-- passes and the snapshot is applied (merged).
--
-- Purely additive:
--   1. run_snapshots table (+ RLS)
--   2. pipeline_runs.merge_status — review-before-merge tracking
--   3. projects.require_merge_approval — per-project toggle
--      (default false: auto-merge, matching the existing
--      "no manual push needed" behavior; opt in to review)
-- ============================================================

-- ---------- 1. Run snapshots (the isolation layer) ----------
create table if not exists run_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  -- Declared scope from the File Scoper sub-step: the ONLY paths the
  -- Builder was supposed to touch.
  declared_scope jsonb not null default '[]'::jsonb,
  -- Paths the Builder actually wrote (pre-enforcement capture).
  written_paths jsonb not null default '[]'::jsonb,
  -- Paths outside the declared scope, if enforcement failed.
  violations jsonb not null default '[]'::jsonb,
  -- How enforcement resolved: pending (not yet checked), ok, or rejected.
  scope_status text not null default 'pending'
    check (scope_status in ('pending', 'ok', 'rejected')),
  -- Full isolation state machine:
  --   pending  = Builder writes captured, awaiting QA/Ops + scope check
  --   ready    = scope ok, waiting to be applied (review-before-merge)
  --   applied  = merged into the files table (the "merge")
  --   rejected = user rejected after review, or enforcement hard-failed
  --   undone   = was applied, then reverted by "Undo last run"
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'applied', 'rejected', 'undone')),
  -- The full pre-run file state: every {path, content} that existed in the
  -- files table for paths the run touched (before/after diff basis) plus
  -- the complete set at merge time for a reliable undo.
  base_files jsonb not null default '[]'::jsonb,
  -- The isolated writes: {path, content} the Builder produced. Only these
  -- ever get applied into the files table on merge.
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id)
);
create index if not exists run_snapshots_project_idx on run_snapshots (project_id, created_at desc);

alter table run_snapshots enable row level security;

create policy "run_snapshots_owner_all" on run_snapshots
  for all using (
    exists (select 1 from projects p where p.id = run_snapshots.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = run_snapshots.project_id and p.user_id = auth.uid())
  );

-- ---------- 2. Review-before-merge tracking on runs ----------
-- pending   = run has an unapplied snapshot (default for compatibility —
--             legacy rows simply never get a snapshot)
-- applied   = snapshot merged; ready/rejected/undone mirror the snapshot
alter table pipeline_runs add column if not exists merge_status text
  not null default 'pending'
  check (merge_status in ('pending', 'ready', 'applied', 'rejected', 'undone'));

-- ---------- 3. Per-project merge approval toggle ----------
-- Default false = auto-merge (existing behavior). Projects that opt in via
-- Settings hold every run's snapshot at "ready" until the user approves.
alter table projects add column if not exists require_merge_approval
  boolean not null default false;
