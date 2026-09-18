import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OfficeWorkspace from "./OfficeWorkspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) redirect("/projects");

  const { data: runs } = await supabase
    .from("pipeline_runs")
    .select("*, pipeline_steps(*)")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  const { data: files } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", id)
    .order("path", { ascending: true });

  const { data: memory } = await supabase
    .from("project_memory")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();

  const { data: roleModels } = await supabase
    .from("role_models")
    .select("*")
    .eq("project_id", id);

  const { data: apiKeys } = await supabase
    .from("api_keys")
    .select("provider")
    .eq("user_id", user.id);

  const { data: deploys } = await supabase
    .from("deploys")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, project_id, type, name, base_url, extra_config, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  const configuredProviders = (apiKeys ?? []).map((k) => k.provider);

  return (
    <OfficeWorkspace
      project={project}
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
