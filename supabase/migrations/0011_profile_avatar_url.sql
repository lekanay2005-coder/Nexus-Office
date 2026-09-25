-- Addendum 10 Phase 3 (follow-up): profile avatar column.
-- 0008_profile_avatar.sql created the `avatars` storage bucket, but the
-- profiles.avatar_url column itself was never added by any migration —
-- surfaced in production as "column profiles.avatar_url does not exist"
-- when the profile page loaded. Purely additive and idempotent.
alter table profiles add column if not exists avatar_url text;
