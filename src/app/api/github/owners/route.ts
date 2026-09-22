import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKey } from "@/lib/apiKeys";
import { listOwners, listOwnerRepos, createOrgRepo, createUserRepo } from "@/lib/deploy/github";

// Addendum 9 Phase 1: GitHub org/repo picker.
//
// GET → the user's personal account plus every org they belong to, plus the
// first page of the personal account's repos (so the picker opens ready).
// Optional ?owner=<login> swaps the repo listing to that org/account.
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getDecryptedApiKey(supabase, user.id, "github");
  if (!token) return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });

  try {
    const owners = await listOwners(token);
    const requested = new URL(req.url).searchParams.get("owner");
    const active =
      requested && owners.some((o) => o.login === requested) ? requested : owners[0].login;
    const repos = await listOwnerRepos(token, active, owners[0].login);
    return NextResponse.json({ owners, activeOwner: active, repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list owners";
    const status = /401|403/.test(message) ? 401 : 500;
    return NextResponse.json(
      { error: status === 401 ? "RECONNECT_GITHUB" : message },
      { status }
    );
  }
}

// Body: { owner?: string, name: string, private: boolean, projectId: string }
// Creates the repo under the chosen owner (personal account or org) and
// wires the project to it. project.github_owner records the org/account
// context so different projects can live in different orgs.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const isPrivate = Boolean(body?.private);
  const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
  if (!name || !projectId) {
    return NextResponse.json({ error: "name and projectId are required" }, { status: 400 });
  }

  const token = await getDecryptedApiKey(supabase, user.id, "github");
  if (!token) return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });

  try {
    const owners = await listOwners(token);
    const personalLogin = owners[0].login;
    const active = owner && owners.some((o) => o.login === owner) ? owner : personalLogin;

    const repo =
      active === personalLogin
        ? await createUserRepo(token, name, isPrivate)
        : await createOrgRepo(token, active, name, isPrivate);

    const { data: project, error } = await supabase
      .from("projects")
      .update({
        github_owner: active,
        github_repo: repo.fullName,
        default_branch: repo.defaultBranch,
        last_synced_commit_sha: null,
      })
      .eq("id", projectId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ project, repo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create repo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
