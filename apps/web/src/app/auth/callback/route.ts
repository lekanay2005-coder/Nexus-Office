import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { setUserProviderKey } from "@/lib/secrets";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/projects";
  const error = searchParams.get("error");

  // GitHub may redirect back with ?error=access_denied if the user cancels
  // the OAuth consent screen. Surface it on the login page instead of
  // silently hanging on a blank callback.
  if (error) {
    const callbackUrl = `${origin}/login?oauth_error=${encodeURIComponent(error)}`;
    return NextResponse.redirect(callbackUrl);
  }

  if (!code) {
    // No code — either a malformed callback or the Supabase dashboard
    // redirected here without one. Bounce to login rather than a 404.
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !data.session) {
    return NextResponse.redirect(
      `${origin}/login?oauth_error=${encodeURIComponent(exchangeError?.message ?? "No session established")}`
    );
  }

  // GitHub OAuth sign-ins carry the user's own GitHub access token in the
  // session — store it as their "github" connection so Deploy Desk's
  // Save to GitHub works immediately, with no separate PAT needed. Only
  // present for OAuth logins (not email/password), and only overwrites
  // what's there if GitHub actually returned a token this time.
  const providerToken = data.session.provider_token;
  if (providerToken && data.user) {
    try {
      // Secrets vault is the source of truth for the token now.
      await setUserProviderKey(supabase, data.user.id, "github", providerToken);
      // Legacy mirror keeps pre-vault readers working during transition.
      // Wrapped in its own try/catch so a failed mirror (e.g. constraint
      // mismatch on older migrations) doesn't block the session redirect.
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
        // vault already has the token; legacy mirror failure is non-fatal
      }
    } catch {
      // Non-fatal — the user can still add a GitHub token manually via
      // Settings -> Connections if this silently fails (e.g. missing
      // NEXUS_ENCRYPTION_KEY in this environment).
    }
  }

  // Validate the redirect target so an attacker can't bounce the user to
  // an arbitrary external URL via a crafted ?next= param.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/projects";

  return NextResponse.redirect(`${origin}${safeNext}`);
}
