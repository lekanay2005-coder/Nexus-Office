-- Addendum 4: watermark / branding feature flags on the project row.
-- Purely additive: new nullable/ defaulted columns, no existing column or
-- table changes.

alter table projects add column if not exists is_pro boolean not null default false;
alter table projects add column if not exists show_preview_watermark boolean not null default true;
alter table projects add column if not exists watermark_deployed_site boolean not null default true;
