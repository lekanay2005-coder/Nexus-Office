# Nexus Office — End-to-End Test Checklist

Manual checklist for the full user flow. **Run this by hand after each major
addendum.** Do not automate these into a test suite yet — this is a human pass
over the whole product.

Setup: fresh incognito window, dev server running (`npm run dev`), test
account available.

---

## Accounts

- [ ] Sign up with email; sign up with GitHub; confirm no duplicate accounts on matching email
- [ ] Create a new project; confirm GitHub repo link/create flow works with no dead ends

## Office Chat & Pipeline

- [ ] Send a simple message in Office Chat; confirm it bypasses the full pipeline (Strategist decides)
- [ ] Send a complex message; confirm all 5 roles run in order and stream visibly
- [ ] Confirm Builder's code output appears in Code Canvas's file tree automatically

## Code Canvas & Memory

- [ ] Edit a file manually in Code Canvas; confirm it commits to GitHub and Memory Board logs it

## Integrations & Deploy

- [ ] Add an AI provider integration via the Integrations panel; confirm it appears in Model Router
- [ ] Add a hosting integration; confirm it appears in Deploy Desk
- [ ] Trigger a deploy; confirm approval-gating modal appears (if enabled) and Audit Log records it

## Cost

- [ ] Check Cost Meter reflects token usage from the test pipeline runs

## UI / Brand / Accessibility

- [ ] Resize browser from 320px to 2560px; confirm no layout breakage on any page
- [ ] Toggle `prefers-reduced-motion`; confirm HackerBackground stops animating
- [ ] Confirm favicon/logo/background render correctly on a fresh incognito load with no flash of unstyled content

---

## Current build state notes (honest gaps, as of Addendum 7)

These checklist items exercise features that are not fully built yet — mark
them as "blocked" rather than "fail" until the relevant addendum lands:

- **Sign up with GitHub** — auth is email/password (Supabase) only; no OAuth
  providers configured yet. Duplicate-account prevention for matching emails
  is Supabase auth behavior once GitHub OAuth is added.
- **Approval-gating modal** — not built. Deploys trigger immediately from
  Deploy Desk; history is tracked per deploy row.
- **Audit Log** — not built as a dedicated page. Decision history lives in the
  Memory Board; full per-role run history is in the pipeline run records.
- **"Commits to GitHub" from Code Canvas edits** — GitHub push happens via
  Deploy Desk ("Deploy Now"), not automatically on file save.
- **Bundled/managed AI credits** — Pro tier ships with bring-your-own keys;
  the upgrade payment flow itself is a stub ("Coming soon") until Stripe is
  requested.
