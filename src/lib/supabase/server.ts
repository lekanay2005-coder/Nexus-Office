import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side client bound to the requesting user's session (respects RLS).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
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
    }
  );
}
