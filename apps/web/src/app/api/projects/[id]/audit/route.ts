import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

const ACTORS = ["user", "strategist", "builder", "analyst", "qa", "ops", "system"];
const MAX_LIMIT = 200;

// Filterable audit timeline. Query params: actor, action (prefix match),
// q (search over action/target/metadata), from, to (ISO dates), limit.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const actor = url.searchParams.get("actor");
  const action = url.searchParams.get("action");
  const q = url.searchParams.get("q");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, MAX_LIMIT);

  let query = supabase
    .from("audit_events")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (actor && ACTORS.includes(actor)) query = query.eq("actor", actor);
  if (action) query = query.ilike("action", `${action}%`);
  if (q) query = query.or(`action.ilike.%${q}%,target.ilike.%${q}%`);
  if (from) query = query.gte("created_at", from);
  if (to) {
    // Make the "to" date inclusive of the whole day.
    const toDate = new Date(to);
    toDate.setDate(toDate.getDate() + 1);
    query = query.lt("created_at", toDate.toISOString());
  }

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: events ?? [] });
}

// The only client-writable audit event: a rejection of an approval modal
// (approvals themselves are logged server-side when the confirmed request
// executes). Kept intentionally narrow so the log stays trustworthy.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.action !== "approval.rejected") {
    return NextResponse.json({ error: "Only approval.rejected events can be logged" }, { status: 400 });
  }

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "approval.rejected",
    target: typeof body?.target === "string" ? body.target : null,
    metadata:
      body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
  });

  return NextResponse.json({ ok: true });
}
