-- Deploy Desk: widen api_keys to also hold GitHub/Vercel tokens (same
-- encrypted-at-rest mechanism as the LLM provider keys), and give deploys
-- an explicit branch column for the pushed commit.

alter table api_keys drop constraint if exists api_keys_provider_check;
alter table api_keys add constraint api_keys_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'github', 'vercel'));

alter table deploys add column if not exists branch text;
