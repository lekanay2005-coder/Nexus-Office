import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

// Addendum 13 section 3: per-user onboarding walkthrough state.
// GET  → { onboardingCompleted: boolean }
// PATCH { completed: true } → persists completion (finished or skipped).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getOrCreateProfile(supabase, user.id).catch(() => null);
  return NextResponse.json({ onboardingCompleted: profile?.onboarding_completed ?? false });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const completed = body?.completed === true;

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_completed: completed, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
