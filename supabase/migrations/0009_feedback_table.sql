-- Addendum 10 Phase 4: feedback submissions.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('bug', 'feature', 'general')),
  message text not null,
  screenshot_url text,
  project_id uuid references projects (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_user_id_idx on feedback (user_id);
create index if not exists feedback_created_at_idx on feedback (created_at desc);

alter table feedback enable row level security;

create policy "feedback_owner_read" on feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
