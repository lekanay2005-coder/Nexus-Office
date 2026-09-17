import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewProjectForm from "./NewProjectForm";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Your Projects</h1>
          <form action="/auth/signout" method="post">
            <SignOutButton />
          </form>
        </div>

        <NewProjectForm />

        <ul className="mt-8 space-y-2">
          {(projects ?? []).map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 hover:border-neutral-600"
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-neutral-500">
                  Created {new Date(p.created_at).toLocaleString()}
                </div>
              </Link>
            </li>
          ))}
          {(!projects || projects.length === 0) && (
            <li className="text-sm text-neutral-500">
              No projects yet. Create one above to open the Office.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function SignOutButton() {
  return (
    <button className="text-sm text-neutral-400 hover:text-neutral-200" type="submit">
      Sign out
    </button>
  );
}
