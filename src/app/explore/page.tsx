import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SetupRequired from "@/components/SetupRequired";
import NexusLogo from "@/components/brand/NexusLogo";
import ExploreBoard from "@/components/explore/ExploreBoard";

export const metadata: Metadata = {
  title: "Explore — Nexus Office",
};

// Addendum 13 section 4: public "World Board". No login required to view.
// Renders client-side from /api/explore so search/tag filtering stays snappy.

export default async function ExplorePage() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return <SetupRequired />;
  }

  // Optional session: signed-in visitors can "Use this prompt" directly.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NexusLogo surface="nav" />
            <div>
              <Link
                href={user ? "/projects" : "/login"}
                className="text-sm text-neutral-500 hover:text-neutral-300"
              >
                {user ? "← Projects" : "← Sign in"}
              </Link>
              <h1 className="mt-1 text-2xl font-semibold">Explore</h1>
              <p className="text-xs text-neutral-500">
                Public prompts shared by the Nexus Office community.
              </p>
            </div>
          </div>
          <Link
            href="/prompts"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Your Prompt Vault
          </Link>
        </div>

        <ExploreBoard signedIn={Boolean(user)} />
      </div>
    </div>
  );
}
