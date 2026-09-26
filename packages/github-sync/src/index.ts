// @nexus/github-sync — GitHub read/write logic shared by the Nexus Office
// web app and CLI: the raw git-data-API client, the Prompt Vault storage
// layer, and pure diff helpers. Supabase-dependent orchestration (3-way sync
// planning, conflict resolution) stays in apps/web since it needs the user's
// encrypted key storage; everything here takes a plain token.

export * from "./github";
export * from "./diff";
