import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKey } from "@/lib/apiKeys";
import { listOwnerRepos, listOwners, createUserRepo } from "@/lib/deploy/github";

// Addendum 9: supports ?owner=<login> — the personal login lists the user's
// own repos, an org login lists that org's repos. No owner = all personal
// repos (backward compatible with the pre-picker flow).
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getDecryptedApiKey(supabase, user.id, "github");
  if (!token) {
    return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });
  }

  try {
    const requested = new URL(req.url).searchParams.get("owner");
    let repos;
    if (requested) {
      const owners = await listOwners(token);
      const personalLogin = owners[0].login;
      const owner = owners.some((o) => o.login === requested) ? requested : personalLogin;
      repos = await listOwnerRepos(token, owner, personalLogin);
    } else {
      const owners = await listOwners(token);
      repos = await listOwnerRepos(token, owners[0].login, owners[0].login);
    }
    return NextResponse.json({ repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list repos";
    const status = /401|403/.test(message) ? 401 : 500;
    return NextResponse.json(
      { error: status === 401 ? "RECONNECT_GITHUB" : message },
      { status }
    );
  }
}

// Body: { name: string, private: boolean } — creates the repo and connects
// this project to it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const isPrivate = Boolean(body?.private);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const token = await getDecryptedApiKey(supabase, user.id, "github");
  if (!token) {
    return NextResponse.json({ error: "RECONNECT_GITHUB" }, { status: 401 });
  }

  try {
    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    const owners = await listOwners(token);
    const personalLogin = owners[0].login;
    const repo = await createUserRepo(token, name, isPrivate);
    const { data: project, error } = await supabase
      .from("projects")
      .update({
        // A repo created via this legacy endpoint always lands on the
        // personal account; the org picker route handles org repos.
        github_owner: owner && owners.some((o) => o.login === owner) ? owner : personalLogin,
        github_repo: repo.fullName,
        default_branch: repo.defaultBranch,
        last_synced_commit_sha: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ project, repo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create repo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
