-- ============================================================
-- Addendum 3 (Arena OS feature import) — purely additive.
-- 1. Dedicated encrypted secrets vault
-- 2. Audit log
-- 3. Capability-based role permissions
-- 4. Per-project approval gating for production actions
-- No existing column is changed or removed; projects only gains
-- require_approval with a safe default.
-- ============================================================

-- ---------- 1. Secrets vault ----------
create table if not exists secrets (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('user', 'project')),
  owner_id uuid not null,
  key_name text not null,
  encrypted_value text not null,
  created_at timestamptz not null default now(),
  unique (owner_type, owner_id, key_name)
);
create index if not exists secrets_owner_idx on secrets (owner_type, owner_id, key_name);

alter table secrets enable row level security;

create policy "secrets_owner_all" on secrets
  for all using (
    (owner_type = 'user' and auth.uid() = owner_id)
    or (
      owner_type = 'project'
      and exists (select 1 from projects p where p.id = secrets.owner_id and p.user_id = auth.uid())
    )
  ) with check (
    (owner_type = 'user' and auth.uid() = owner_id)
    or (
      owner_type = 'project'
      and exists (select 1 from projects p where p.id = secrets.owner_id and p.user_id = auth.uid())
    )
  );

-- ---------- 2. Audit log ----------
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null,
  actor text not null check (actor in ('user', 'strategist', 'builder', 'analyst', 'qa', 'ops', 'system')),
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_project_created_idx on audit_events (project_id, created_at desc);
create index if not exists audit_events_action_idx on audit_events (project_id, action);

alter table audit_events enable row level security;

create policy "audit_events_owner_all" on audit_events
  for all using (
    exists (select 1 from projects p where p.id = audit_events.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = audit_events.project_id and p.user_id = auth.uid())
  );

-- ---------- 3. Capability-based permissions ----------
create table if not exists role_capabilities (
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('strategist', 'builder', 'analyst', 'qa', 'ops')),
  capability text not null,
  granted boolean not null default false,
  primary key (project_id, role, capability)
);
create index if not exists role_capabilities_project_idx on role_capabilities (project_id);

alter table role_capabilities enable row level security;

create policy "role_capabilities_owner_all" on role_capabilities
  for all using (
    exists (select 1 from projects p where p.id = role_capabilities.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = role_capabilities.project_id and p.user_id = auth.uid())
  );

-- ---------- 4. Approval gating (per project, on by default) ----------
alter table projects add column if not exists require_approval boolean not null default true;
