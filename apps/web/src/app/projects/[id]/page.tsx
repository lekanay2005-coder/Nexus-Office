import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OfficeWorkspace from "./OfficeWorkspace";
import SetupRequired from "@/components/SetupRequired";
import { getOrCreateProfile } from "@/lib/profile";
import { perfTimer } from "@/lib/perf";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return <SetupRequired />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Addendum 9: lazily create the profile row on workspace entry so the
  // display-name prompt has something to read/update. Best-effort — the
  // workspace renders even if the profiles table hasn't been migrated yet.
  const profile = await getOrCreateProfile(supabase, user.id).catch(() => null);

  // Parallelize all independent reads — the previous code awaited them
  // one-by-one, adding unnecessary round-trip latency on project load.
  const timer = perfTimer("project.load");
  const [projectRes, runsRes, filesRes, memoryRes, roleModelsRes, apiKeysRes, deploysRes, integrationsRes] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).single(),
      supabase.from("pipeline_runs").select("*, pipeline_steps(*)").eq("project_id", id).order("created_at", { ascending: true }),
      supabase.from("files").select("*").eq("project_id", id).order("path", { ascending: true }),
      supabase.from("project_memory").select("*").eq("project_id", id).maybeSingle(),
      supabase.from("role_models").select("*").eq("project_id", id),
      supabase.from("api_keys").select("provider").eq("user_id", user.id),
      supabase.from("deploys").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      supabase.from("integrations").select("id, project_id, type, name, base_url, extra_config, created_at").eq("project_id", id).order("created_at", { ascending: true }),
    ]);
  timer.end();

  const project = projectRes.data;
  if (!project) redirect("/projects");

  const { data: runs } = runsRes;
  const { data: files } = filesRes;
  const { data: memory } = memoryRes;
  const { data: roleModels } = roleModelsRes;
  const { data: apiKeys } = apiKeysRes;
  const { data: deploys } = deploysRes;
  const { data: integrations } = integrationsRes;

  const configuredProviders = (apiKeys ?? []).map((k) => k.provider);

  return (
    <OfficeWorkspace
      project={project}
      displayName={profile?.display_name ?? ""}
      avatarUrl={profile?.avatar_url ?? null}
      email={user.email ?? null}
      initialRuns={runs ?? []}
      initialFiles={files ?? []}
      initialMemory={memory}
      initialRoleModels={roleModels ?? []}
      initialApiKeyProviders={configuredProviders.filter(
        (p): p is "anthropic" | "openai" | "google" =>
          p === "anthropic" || p === "openai" || p === "google"
      )}
      initialConnectionProviders={configuredProviders.filter(
        (p): p is "github" | "vercel" => p === "github" || p === "vercel"
      )}
      initialDeploys={deploys ?? []}
      initialIntegrations={integrations ?? []}
    />
  );
}
