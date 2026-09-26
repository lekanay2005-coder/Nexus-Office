#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline";
import { loadConfig, saveConfig, clearAuth } from "./config.js";
import { loginBrowser, loginWithToken } from "./auth.js";
import { resolveProject, gitRemoteForCwd } from "./project.js";
import { createNexusClient, ApiError } from "@nexus-office/api-client";
import { listVaultPrompts, ensureVaultRepo, getAuthenticatedUser } from "@nexus/github-sync";


// @nexus-office/cli — the `nexus` command (Addendum 17 Phase 3).
// Built on @nexus-office/api-client + @nexus/github-sync from the monorepo,
// so the CLI and web app share one implementation of pipeline calls,
// merging, and GitHub sync.

const ROLE_COLORS: Record<string, string> = {
  strategist: "\x1b[35m",
  builder: "\x1b[36m",
  analyst: "\x1b[32m",
  qa: "\x1b[33m",
  ops: "\x1b[31m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function makeClient() {
  const cfg = loadConfig();
  return createNexusClient({ baseUrl: cfg.baseUrl, token: cfg.accessToken });
}

function roleLabel(role: string): string {
  const pad = role[0].toUpperCase() + role.slice(1);
  return `${ROLE_COLORS[role] ?? ""}${pad}${RESET}`;
}

// ---------------------------------------------------------------------------
// nexus login / logout
// ---------------------------------------------------------------------------

async function loginCommand(opts: { token?: string }) {
  const baseUrl = loadConfig().baseUrl;
  if (opts.token) {
    await loginWithToken(baseUrl, opts.token);
    console.log("✓ Token saved to ~/.nexus/config");
    return;
  }
  await loginBrowser(baseUrl);
  console.log("✓ Logged in. Credentials stored at ~/.nexus/config");
}

function logoutCommand() {
  clearAuth();
  console.log("✓ Signed out (local credentials removed).");
}

// ---------------------------------------------------------------------------
// nexus projects list
// ---------------------------------------------------------------------------

async function projectsList() {
  const nexus = makeClient();
  const projects = await nexus.listProjects();
  if (projects.length === 0) {
    console.log("No projects yet. Create one in the web app.");
    return;
  }
  const remote = gitRemoteForCwd();
  for (const p of projects) {
    const here = remote && p.github_repo === remote ? "  ← here" : "";
    console.log(`${p.id}  ${p.name}${p.github_repo ? `  (${p.github_repo})` : ""}${here}`);
  }
}

// ---------------------------------------------------------------------------
// nexus chat — 5-role pipeline with isolation-aware review
// ---------------------------------------------------------------------------

async function chatCommand(message: string, opts: { project?: string; yes?: boolean }) {
  const nexus = makeClient();
  const project = await resolveProject(nexus.client, opts.project);
  console.log(
    `${DIM}project: ${project.name}${project.github_repo ? ` (${project.github_repo})` : ""}${RESET}\n`
  );

  const result = await nexus.runPipeline(project.id, message, (step) => {
    const preview = (step.output ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    console.log(`${roleLabel(step.role)} ${DIM}${preview}${RESET}`);
  });

  console.log();
  console.log(result.finalMessage);

  // Addendum 17: isolation status + review flow (same as the web chat UI).
  const isolation = result.isolation;
  if (!isolation || isolation.status === "none") return;

  if (isolation.status === "ready") {
    const candidate = await nexus.getMergeCandidate(project.id);
    if (candidate) {
      console.log(`\n${DIM}── awaiting review before merge ──${RESET}`);
      for (const f of candidate.files) {
        console.log(`  ${f.path} ${DIM}(+${f.added} −${f.removed})${RESET}`);
      }
      console.log(`  ${DIM}total: +${candidate.totalAdded} −${candidate.totalRemoved}${RESET}`);
    }
    if (!opts.yes) {
      const answer = await prompt("\nMerge these changes into your project? [y/N] ");
      if (!/^(y|yes)$/i.test(answer.trim())) {
        await nexus.rejectRun(project.id, result.runId);
        console.log("Discarded — nothing was merged.");
        return;
      }
    }
    await nexus.mergeRun(project.id, result.runId);
    console.log(`✓ Merged ${isolation.files.length} file(s) into your project.`);
  } else if (isolation.status === "applied") {
    console.log(
      `\n✓ Auto-merged ${isolation.files.length} file(s): ${isolation.files.join(", ")}` +
        `\n  ${DIM}undo anytime with \`nexus undo\`${RESET}`
    );
  } else if (isolation.status === "rejected") {
    console.log("\n✕ This run's changes were rejected — nothing was merged.");
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

// ---------------------------------------------------------------------------
// nexus sync — force-push local state to GitHub
// ---------------------------------------------------------------------------

async function syncCommand(opts: { project?: string; yes?: boolean }) {
  const nexus = makeClient();
  const project = await resolveProject(nexus.client, opts.project);
  try {
    const result = await nexus.syncToGitHub(project.id, { confirmed: true });
    if (result.status === "pushed") {
      console.log(`✓ Pushed to GitHub: ${result.url ?? "(no URL)"}`);
    } else {
      console.log(`Sync status: ${result.status}`);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      if (opts.yes) {
        const result = await nexus.syncToGitHub(project.id, {
          confirmed: true,
          resolutions: {},
        });
        console.log(`✓ Pushed (ours won on any conflicts): ${result.url ?? "(no URL)"}`);
        return;
      }
      console.log(
        "The GitHub repo has diverged — resolve conflicts in the web app's Deploy Desk,\nor re-run with --yes to push your local versions on conflicting files."
      );
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// nexus vault list / use
// ---------------------------------------------------------------------------

async function vaultList() {
  const nexus = makeClient();
  try {
    const prompts = await nexus.listVaultPrompts();
    printPrompts(prompts.map((p) => ({ id: p.id, title: p.title, tags: p.tags })));
  } catch {
    // Fall back to reading the GitHub vault repo directly.
    const cfg = loadConfig();
    if (!cfg.accessToken) throw new Error("Not logged in — run `nexus login` first.");
    const me = await getAuthenticatedUser(cfg.accessToken);
    const repo = await ensureVaultRepo(cfg.accessToken, me.login);
    const prompts = await listVaultPrompts(cfg.accessToken, repo);
    printPrompts(prompts.map((p) => ({ id: p.id, title: p.title, tags: p.tags })));
  }
}

function printPrompts(prompts: { id: string; title: string; tags: string[] }[]) {
  if (prompts.length === 0) {
    console.log("Prompt Vault is empty.");
    return;
  }
  for (const p of prompts) {
    console.log(`${p.id}  ${p.title} ${DIM}[${p.tags.join(", ")}]${RESET}`);
  }
}

async function vaultUse(id: string) {
  const nexus = makeClient();
  const prompts = await nexus.listVaultPrompts();
  const found = prompts.find((p) => p.id === id || p.title.toLowerCase() === id.toLowerCase());
  if (!found) {
    throw new Error(`No prompt with id or title "${id}". Run \`nexus vault list\`.`);
  }
  console.log(`\n# ${found.title}\n\n${found.body}\n`);
}

// ---------------------------------------------------------------------------
// nexus deploy
// ---------------------------------------------------------------------------

async function deployCommand(opts: { project?: string; yes?: boolean }) {
  const nexus = makeClient();
  const project = await resolveProject(nexus.client, opts.project);
  if (!opts.yes) {
    const answer = await prompt(`Deploy "${project.name}" to production? [y/N] `);
    if (!/^(y|yes)$/i.test(answer.trim())) {
      console.log("Aborted.");
      return;
    }
  }
  const result = await nexus.deployProject(project.id, { confirmed: true });
  console.log("✓ Deploy triggered:", result.deploy?.status ?? result);
}

// ---------------------------------------------------------------------------
// nexus undo
// ---------------------------------------------------------------------------

async function undoCommand(opts: { project?: string }) {
  const nexus = makeClient();
  const project = await resolveProject(nexus.client, opts.project);
  const result = await nexus.undoLastRun(project.id);
  console.log(result.message);
}

// ---------------------------------------------------------------------------
// REPL — run with no arguments in a connected project directory
// ---------------------------------------------------------------------------

async function repl(opts: { project?: string; yes?: boolean }) {
  const nexus = makeClient();
  const project = await resolveProject(nexus.client, opts.project);
  console.log(
    `Nexus Office — ${project.name}${project.github_repo ? ` (${project.github_repo})` : ""}`
  );
  console.log(`${DIM}Type a message for your team, or /quit to exit.${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "nexus> ",
  });
  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed === "/quit" || trimmed === "/exit") {
      rl.close();
      return;
    }
    if (trimmed === "/undo") {
      try {
        const result = await nexus.undoLastRun(project.id);
        console.log(result.message);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
      rl.prompt();
      return;
    }

    try {
      await chatCommand(trimmed, { project: project.id, yes: opts.yes });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nbye.");
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("nexus")
  .description("Nexus Office CLI — your 5-role AI dev team in the terminal.")
  .version("0.1.0");

program
  .command("login")
  .description("Sign in via the browser (or paste a token with --token). Stores credentials at ~/.nexus/config.")
  .option("--token <token>", "sign in with a Supabase access token instead of the browser")
  .action(loginCommand);

program.command("logout").description("Remove local credentials.").action(logoutCommand);

const projects = program.command("projects").description("Manage projects.");
projects
  .command("list")
  .description("List your projects (marks the one matching the current git remote).")
  .action(projectsList);

program
  .command("chat")
  .description("Run the 5-role pipeline against the current project, streaming each role's output.")
  .argument("<message>")
  .option("-p, --project <id>", "project id or name (default: auto-detected from the git remote)")
  .option("-y, --yes", "auto-approve the merge review prompt")
  .action(chatCommand);

program
  .command("sync")
  .description("Force-push your project's files to GitHub now (same as the web app's Force sync).")
  .option("-p, --project <id>", "project id or name")
  .option("-y, --yes", "take your local version on conflicting files")
  .action(syncCommand);

const vault = program.command("vault").description("Browse your Prompt Vault.");
vault.command("list").description("List prompts in your vault.").action(vaultList);
vault
  .command("use <id>")
  .description("Print a prompt's full body (pipe it into nexus chat).")
  .action(vaultUse);

program
  .command("deploy")
  .description("Trigger Deploy Desk from the terminal.")
  .option("-p, --project <id>", "project id or name")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(deployCommand);

program
  .command("undo")
  .description("Undo the last applied pipeline run (restore its pre-run state).")
  .option("-p, --project <id>", "project id or name")
  .action(undoCommand);

// No arguments: interactive REPL in the current project directory.
if (process.argv.length <= 2) {
  repl({}).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    if (err instanceof ApiError) {
      console.error(`Error (${err.status}): ${err.message}`);
      if (err.status === 401) console.error("Run `nexus login` first.");
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exit(1);
  });
}

export { saveConfig };
