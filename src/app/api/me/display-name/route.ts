import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile, sanitizeDisplayName } from "@/lib/profile";

// Addendum 9 Phase 1: display-name identity.
// Addendum 10 Phase 3: also returns avatar_url, email, GitHub metadata, and
// account created_at so the profile page can show full account info.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getOrCreateProfile(supabase, user.id);
  return NextResponse.json({
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    // One-time naming prompt: shown until the user picks a name (or skips).
    needsDisplayName: profile.display_name.length === 0,
    // Account metadata for the profile page.
    email: user.email ?? null,
    githubLogin: (user.app_metadata as Record<string, unknown>)?.provider === "github"
      ? ((user.user_metadata as Record<string, unknown>)?.user_name ??
        (user.user_metadata as Record<string, unknown>)?.preferred_username ??
        null)
      : null,
    memberSince: user.created_at ?? profile.created_at,
  });
}

// Body: { displayName: string }
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const displayName = sanitizeDisplayName(typeof body?.displayName === "string" ? body.displayName : "");
  if (!displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, display_name: displayName, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ displayName });
}
