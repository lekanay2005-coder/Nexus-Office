import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

// Server-side client bound to the requesting user's session (respects RLS).
//
// Addendum 17 (CLI): the request's Authorization header is checked first.
// `nexus login` obtains a Supabase access token from the same auth backend
// the web app uses, and the CLI sends it as a Bearer token — so every API
// route works for both surfaces with zero duplication.
export async function createClient() {
  const cookieStore = await cookies();

  // Bearer token from the CLI (or any API client).
  let bearer: string | undefined;
  try {
    const headerStore = await headers();
    const auth = headerStore.get("authorization");
    if (auth?.toLowerCase().startsWith("bearer ")) {
      bearer = auth.slice(7).trim() || undefined;
    }
  } catch {
    // headers() unavailable in this context — cookie-only.
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component with no writable cookies; safe to ignore
            // because middleware refreshes the session.
          }
        },
      },
      global: {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      },
    }
  );

  return supabase;
}
