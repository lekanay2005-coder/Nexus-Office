#!/usr/bin/env node
// Re-executes the TypeScript entry under tsx so the workspace packages'
// TS entry points (@nexus-office/api-client etc.) load directly in dev.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", entry, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env }
);
process.exit(result.status ?? 1);
