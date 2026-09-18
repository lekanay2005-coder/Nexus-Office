-- Generic integrations system: lets a project add any AI provider or
-- hosting service by name + base URL + key, without new code per provider.
-- Also adds the columns Deploy Desk's "Save to GitHub" needs to track sync
-- state and the repo's default branch.

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  type text not null check (type in ('ai_provider', 'hosting')),
  name text not null,
  base_url text,
  api_key_encrypted text not null,
  extra_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists integrations_project_id_idx on integrations (project_id);

alter table integrations enable row level security;

create policy "integrations_owner_all" on integrations
  for all using (
    exists (select 1 from projects p where p.id = integrations.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = integrations.project_id and p.user_id = auth.uid())
  );

alter table projects add column if not exists default_branch text;
alter table projects add column if not exists last_synced_to_github_at timestamptz;
