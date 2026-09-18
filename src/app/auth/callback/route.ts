import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/projects";

  if (code) {
    const supabase = await createClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    // GitHub OAuth sign-ins carry the user's own GitHub access token in the
    // session — store it as their "github" connection so Deploy Desk's
    // Save to GitHub works immediately, with no separate PAT needed. Only
    // present for OAuth logins (not email/password), and only overwrites
    // what's there if GitHub actually returned a token this time.
    const providerToken = data.session?.provider_token;
    if (providerToken && data.user) {
      try {
        await supabase.from("api_keys").upsert(
          {
            user_id: data.user.id,
            provider: "github",
            encrypted_key: encryptSecret(providerToken),
          },
          { onConflict: "user_id,provider" }
        );
      } catch {
        // Non-fatal — the user can still add a GitHub token manually via
        // Settings -> Connections if this silently fails (e.g. missing
        // NEXUS_ENCRYPTION_KEY in this environment).
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
