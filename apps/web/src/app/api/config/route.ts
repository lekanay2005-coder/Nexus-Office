import { NextResponse } from "next/server";

// Public bootstrap for the framework-agnostic static UI in /public/office.
// Only anon-key values are exposed here — the same ones any browser bundle
// ships; RLS on every table still scopes all data to the signed-in user.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Nexus Office is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings → Environment." },
      { status: 503 }
    );
  }

  return NextResponse.json({ supabaseUrl: url, supabaseAnonKey: anonKey });
}
