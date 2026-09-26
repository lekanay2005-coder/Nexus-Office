import { execSync } from "node:child_process";
import { listProjects, type ProjectSummary } from "@nexus-office/api-client";

// Auto-detect the current project: read the current directory's git remote
// URL and match it against the user's connected projects' github_repo.
export function gitRemoteForCwd(): string | null {
  try {
    const out = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return null;
    // Normalize git@github.com:owner/repo.git and https://...owner/repo(.git)
    const match = /[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(out);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function resolveProject(
  api: Parameters<typeof listProjects>[0],
  projectId?: string
): Promise<ProjectSummary> {
  const projects = await listProjects(api);

  if (projectId) {
    const found = projects.find((p) => p.id === projectId || p.name === projectId);
    if (!found) {
      throw new Error(`No project found with id/name "${projectId}". Run \`nexus projects list\`.`);
    }
    return found;
  }

  const remote = gitRemoteForCwd();
  if (remote) {
    const found = projects.find((p) => p.github_repo === remote);
    if (found) return found;
  }

  // No git remote match — fall back to the most recently updated project.
  if (projects.length === 0) {
    throw new Error(
      "No projects in your Nexus Office account. Create one in the web app first."
    );
  }
  if (remote) {
    console.warn(
      `note: current directory's remote (${remote}) isn't connected to a project — using "${projects[0].name}". Use --project <id> to pick one.`
    );
  } else {
    console.warn(
      `note: not in a git repository — using "${projects[0].name}". Use --project <id> to pick one.`
    );
  }
  return projects[0];
}
