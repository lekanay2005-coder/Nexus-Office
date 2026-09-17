import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PromptVault from "@/components/prompts/PromptVault";

export default async function PromptsPage() {
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
