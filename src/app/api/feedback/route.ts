import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Feedback submissions (Addendum 10 Phase 4): persist to the `feedback`
// table created by supabase/migrations/0009_feedback_table.sql. Email
// delivery via RESEND_API_KEY is optional — the row is the source of truth
// and the send is best-effort so a mail outage never loses feedback.
const FEEDBACK_TYPES = new Set(["bug", "feature", "general"]);
const MAX_MESSAGE_LENGTH = 5000;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const screenshotUrl =
    typeof body?.screenshotUrl === "string" && body.screenshotUrl.trim()
      ? body.screenshotUrl.trim()
      : null;
  const projectId = typeof body?.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

  if (!FEEDBACK_TYPES.has(type)) {
    return NextResponse.json({ error: "Invalid feedback type" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (screenshotUrl && !/^https?:\/\//.test(screenshotUrl)) {
    return NextResponse.json({ error: "screenshotUrl must be an http(s) URL" }, { status: 400 });
  }

  const { data: feedback, error } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      type,
      message,
      screenshot_url: screenshotUrl,
      project_id: projectId,
    })
    .select("id, type, message, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort email notification when RESEND_API_KEY + FEEDBACK_EMAIL are
  // configured. Never blocks or fails the submission.
  const resendKey = process.env.RESEND_API_KEY;
  const feedbackEmail = process.env.FEEDBACK_EMAIL;
  if (resendKey && feedbackEmail) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Nexus Office <feedback@resend.dev>",
          to: [feedbackEmail],
          subject: `[${type}] New feedback from ${user.email ?? user.id}`,
          text: message,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Swallow — the DB row already captured the feedback.
    }
  }

  return NextResponse.json({ feedback }, { status: 201 });
}

// Lists the signed-in user's own feedback submissions (RLS also enforces
// this server-side, so this is convenience, not security).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: feedback, error } = await supabase
    .from("feedback")
    .select("id, type, message, screenshot_url, project_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feedback });
}
