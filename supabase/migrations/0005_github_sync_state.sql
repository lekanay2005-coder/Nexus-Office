-- Tracks the commit sha we last successfully synced to, so "Save to
-- GitHub" can detect whether the repo has diverged since then and only
-- needs to diff/merge, not on every push.

alter table projects add column if not exists last_synced_commit_sha text;
