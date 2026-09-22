// Addendum 9 Phase 1: user display identity.
//
// Profiles are created lazily (no DB trigger needed) so both email and
// GitHub signups work identically. The display name is what the UI shows
// wherever the user is referenced, and what GitHub commit authorship is
// attributed to.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/types/db";

// Collapse whitespace, trim, and cap the length — keeps names sane in nav
// chips, audit rows, and git commit authors.
export function sanitizeDisplayName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

// Reads the user's profile row, creating a blank one on first touch.
export async function getOrCreateProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<Profile> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (data) return data as Profile;

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ id: userId, display_name: "" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return created as Profile;
}
