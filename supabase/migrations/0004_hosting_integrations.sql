-- Deploy-hook based hosting integrations (Netlify, Render, etc.) often need
-- no API key at all — the hook URL itself is the secret — so relax the
-- NOT NULL constraint for that case. Track which hosting integration (if
-- any) triggered a given deploy row.

alter table integrations alter column api_key_encrypted drop not null;

alter table deploys add column if not exists hosting_integration_id uuid
  references integrations (id) on delete set null;
