-- Nexus Office initial schema
-- MVP tables: projects, project_memory, pipeline_runs, pipeline_steps, files
-- v2 tables (created now, unused until v2 features ship): role_models, prompts, deploys

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  github_repo text,
  vercel_project_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on projects (user_id);

-- ---------------------------------------------------------------------------
-- project_memory: one row per project, the persistent "brain"
-- ---------------------------------------------------------------------------
create table if not exists project_memory (
  project_id uuid primary key references projects (id) on delete cascade,
  tech_stack jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,      -- [{id, text, role, run_id, created_at}]
  open_issues jsonb not null default '[]'::jsonb,     -- [{id, text, status, created_at}]
  summary text not null default '',                   -- rolling free-text summary fed to roles
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pipeline_runs: one row per user message / pipeline invocation
-- ---------------------------------------------------------------------------
create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_message text not null,
  mode text not null default 'pipeline' check (mode in ('pipeline', 'direct')),
  status text not null default 'running' check (status in ('running', 'complete', 'error')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pipeline_runs_project_id_idx on pipeline_runs (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- pipeline_steps: one row per role invocation within a run
-- ---------------------------------------------------------------------------
create table if not exists pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs (id) on delete cascade,
  role text not null check (role in ('strategist', 'builder', 'analyst', 'qa', 'ops')),
  step_order int not null,
  provider text,
  model text,
  input text,
  output text,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_steps_run_id_idx on pipeline_steps (run_id, step_order);

-- ---------------------------------------------------------------------------
-- files: Code Canvas backing store (path is unique per project)
-- ---------------------------------------------------------------------------
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  path text not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

create index if not exists files_project_id_idx on files (project_id);

-- ---------------------------------------------------------------------------
-- v2: role_models (Model Router)
-- ---------------------------------------------------------------------------
create table if not exists role_models (
  project_id uuid not null references projects (id) on delete cascade,
  role text not null check (role in ('strategist', 'builder', 'analyst', 'qa', 'ops')),
  provider text not null,
  model text not null,
  primary key (project_id, role)
);

-- ---------------------------------------------------------------------------
-- v2: api_keys (user-provided provider keys, encrypted at rest by app layer
-- before insert; never store plaintext in a real deployment)
-- ---------------------------------------------------------------------------
create table if not exists api_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  encrypted_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ---------------------------------------------------------------------------
-- v2: prompts (Prompt Vault)
-- ---------------------------------------------------------------------------
create table if not exists prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prompts_user_id_idx on prompts (user_id);
create index if not exists prompts_tags_idx on prompts using gin (tags);

-- ---------------------------------------------------------------------------
-- v2: deploys (Deploy Desk)
-- ---------------------------------------------------------------------------
create table if not exists deploys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'building', 'ready', 'error')),
  github_commit_sha text,
  vercel_deployment_id text,
  deployment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deploys_project_id_idx on deploys (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table projects enable row level security;
alter table project_memory enable row level security;
alter table pipeline_runs enable row level security;
alter table pipeline_steps enable row level security;
alter table files enable row level security;
alter table role_models enable row level security;
alter table api_keys enable row level security;
alter table prompts enable row level security;
alter table deploys enable row level security;

create policy "projects_owner_all" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "project_memory_owner_all" on project_memory
  for all using (
    exists (select 1 from projects p where p.id = project_memory.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = project_memory.project_id and p.user_id = auth.uid())
  );

create policy "pipeline_runs_owner_all" on pipeline_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "pipeline_steps_owner_all" on pipeline_steps
  for all using (
    exists (select 1 from pipeline_runs r where r.id = pipeline_steps.run_id and r.user_id = auth.uid())
  ) with check (
    exists (select 1 from pipeline_runs r where r.id = pipeline_steps.run_id and r.user_id = auth.uid())
  );

create policy "files_owner_all" on files
  for all using (
    exists (select 1 from projects p where p.id = files.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = files.project_id and p.user_id = auth.uid())
  );

create policy "role_models_owner_all" on role_models
  for all using (
    exists (select 1 from projects p where p.id = role_models.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = role_models.project_id and p.user_id = auth.uid())
  );

create policy "api_keys_owner_all" on api_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "prompts_owner_all" on prompts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "deploys_owner_all" on deploys
  for all using (
    exists (select 1 from projects p where p.id = deploys.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = deploys.project_id and p.user_id = auth.uid())
  );
