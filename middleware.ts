import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function setupPageHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nexus Office — Setup required</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #0b0d12;
        color: #e5e7eb;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .card {
        width: 100%;
        max-width: 620px;
        background: rgba(18, 21, 28, 0.8);
        border: 1px solid #2a2f3a;
        border-radius: 14px;
        padding: 28px;
      }
      h1 { margin: 0 0 6px; font-size: 20px; color: #3ee0e8; }
      p.sub { margin: 0 0 18px; color: #9ca3af; font-size: 14px; }
      ol { margin: 0 0 18px; padding-left: 22px; color: #d1d5db; font-size: 14px; line-height: 1.9; }
      code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
        background: #0b0d12;
        border: 1px solid #2a2f3a;
        border-radius: 6px;
        padding: 2px 6px;
        color: #a78bfa;
      }
      .hint { margin: 0; font-size: 12.5px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Nexus Office — setup required</h1>
      <p class="sub">The server is running, but its Supabase connection isn't configured yet.</p>
      <ol>
        <li>Create a project at <code>supabase.com</code> and copy its URL + anon key from Settings → API.</li>
        <li>Run every migration in <code>supabase/migrations/</code> against it (SQL editor or <code>supabase db push</code>).</li>
        <li>Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Settings → Environment.</li>
        <li>Reload this page.</li>
      </ol>
      <p class="hint">Also add <code>NEXUS_ENCRYPTION_KEY</code> (base64, 32 bytes) and at least one provider key (e.g. <code>ANTHROPIC_API_KEY</code>) before running the AI pipeline.</p>
    </div>
    <script>setTimeout(() => location.reload(), 15000);</script>
  </body>
</html>`;
}

// Serves a friendly "setup required" screen instead of a raw 500 whenever
// the Supabase env vars aren't present yet — the /office/ static UI still
// loads normally since it doesn't need a server session.
export async function middleware(request: NextRequest) {
  if (isConfigured()) return updateSession(request);

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/office/")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error:
          "Nexus Office is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings → Environment.",
      },
      { status: 503 }
    );
  }

  return new NextResponse(setupPageHtml(), {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|office|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
