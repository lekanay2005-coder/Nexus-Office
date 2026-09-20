import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PromptVault from "@/components/prompts/PromptVault";
import SetupRequired from "@/components/SetupRequired";

export default async function PromptsPage() {
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

  const { data: prompts } = await supabase
    .from("prompts")
    .select("*")
    .order("updated_at", { ascending: false });

  return <PromptVault initialPrompts={prompts ?? []} />;
}
