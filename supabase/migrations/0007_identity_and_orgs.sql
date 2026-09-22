-- Addendum 9 Phase 1: user identity + per-project GitHub owner context.
-- Purely additive: a new optional profile table and one nullable column.

-- 1. Display names. Keyed to auth.users; the row is created lazily by the
-- app (getOrCreateProfile) on first authenticated request, so both email
-- and GitHub signups work without a database trigger.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_owner_all" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- 2. Which GitHub account/org context a project is tied to. Holds a GitHub
-- login (user or org name). NULL/empty = the user's personal account, so
-- every pre-existing project keeps working unchanged.
alter table projects add column if not exists github_owner text;
