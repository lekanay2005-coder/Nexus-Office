-- Addendum 13: JSON prompt vault + public Explore board + onboarding state.
-- 1. Prompt visibility (public prompts feed the /explore board).
alter table prompts add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'public'));

-- 2. Cache/index of public prompts for fast Explore search. The GitHub
-- vault repo (prompts/*.json) is the source of truth; this table is the
-- queryable mirror, refreshed on every visibility change / vault sync —
-- the same cache-vs-source-of-truth pattern as the files table.
create table if not exists public_prompts (
  prompt_id uuid primary key references prompts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_display_name text not null default '',
  author_avatar_url text,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists public_prompts_updated_idx on public_prompts (updated_at desc);
create index if not exists public_prompts_tags_idx on public_prompts using gin (tags);

-- Anyone (including anonymous visitors) can read the public board.
alter table public_prompts enable row level security;
create policy "public_prompts_world_read" on public_prompts
  for select using (true);
-- Only the owner can publish/unpublish their own prompts into the cache.
create policy "public_prompts_owner_write" on public_prompts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Manual moderation: user-reported prompts, reviewed in a dashboard.
create table if not exists prompt_reports (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references prompts (id) on delete cascade,
  reported_by uuid references auth.users (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table prompt_reports enable row level security;
create policy "prompt_reports_insert_any" on prompt_reports
  for insert with check (true);
create policy "prompt_reports_owner_read" on prompt_reports
  for select using (reported_by = auth.uid());

-- 4. Per-user onboarding walkthrough state (Addendum 13 section 3).
alter table profiles add column if not exists onboarding_completed boolean not null default false;
