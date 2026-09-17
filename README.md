# Nexus Office

A persistent 5-role AI team (Strategist, Builder, Analyst, QA, Ops) for vibe coders,
running on Next.js + Supabase.

## Status: MVP (modules 1, 2, 4)

- **Project workspace** — create/select a project; each has persistent memory
  (tech stack, decisions log, open issues) in Supabase.
- **Office Chat** — every message runs the Strategist first. Simple questions get
  a direct answer; real work triggers the full pipeline
  (Strategist → Builder → Analyst → QA → Ops), with the full transcript persisted
  per project and Ops updating memory before the run completes.
- **Code Canvas** — file tree + Monaco editor + a best-effort static preview
  iframe. The Builder role's fenced ```path=...``` code blocks are written
  straight into the project's file tree.

Not yet built (v2, scaffolded in the DB schema): Model Router, Prompt Vault,
Deploy Desk, Memory Board UI, Cost Meter.

## Setup

1. Create a Supabase project.
2. Run the migration in `supabase/migrations/0001_init.sql` against it (via the
   SQL editor, or `supabase db push` if using the CLI).
3. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from your
     Supabase project settings.
   - `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`, `GOOGLE_API_KEY`) —
     the MVP runs every role on Claude by default
     (`src/lib/providers/index.ts`); the v2 Model Router will let users pick
     per-role providers via the `role_models` table already in the schema.
4. `npm install`
5. `npm run dev` and open http://localhost:3000. You'll be redirected to
   `/login` — sign up with an email/password (Supabase email confirmation
   applies unless disabled in your project's auth settings).

## How the pipeline works

`src/lib/pipeline/run.ts` is the orchestrator:

1. Loads the project's `project_memory` row (creating it if this is the first run).
2. Calls the Strategist with the memory + user message. The Strategist opens its
   reply with `ROUTE: DIRECT` or `ROUTE: PIPELINE`.
3. **Direct**: the Strategist's answer is returned immediately; no memory update.
4. **Pipeline**: Builder → Analyst → QA → Ops run in sequence, each one receiving
   the project memory, the user's message, and every prior role's output from
   this turn. The Builder's fenced `path=...` code blocks are upserted into the
   `files` table. Ops closes with a `memory-update` JSON block (decisions,
   open issues, new tech stack entries) that gets merged into `project_memory`
   before the run is marked complete.

Every step is persisted to `pipeline_steps` (one row per role) linked to a
`pipeline_runs` row, so the full transcript is queryable per project.

## Schema

See `supabase/migrations/0001_init.sql`. RLS policies restrict every table to
rows owned (directly or via `project_id`/`run_id`) by `auth.uid()`.
