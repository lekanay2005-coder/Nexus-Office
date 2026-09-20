import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getEffectiveCapabilities,
  saveCapabilities,
  ALL_CAPABILITIES,
  type CapabilityMap,
  type Capability,
} from "@/lib/capabilities";
import { ROLES } from "@/types/db";
import { logAudit } from "@/lib/audit";

// Effective per-role capabilities: stored overrides merged with the
// built-in least-privilege defaults (projects with no rows see defaults).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const capabilities = await getEffectiveCapabilities(supabase, id);
  return NextResponse.json({ capabilities });
}

// Body: { capabilities: Partial<CapabilityMap> } — the complete desired
// grant list per role. Untouched roles keep their defaults.
export async function PUT(
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
  const desired = body?.capabilities;
  if (!desired || typeof desired !== "object") {
    return NextResponse.json({ error: "capabilities object is required" }, { status: 400 });
  }

  // Validate shape before persisting anything.
  const clean: Partial<CapabilityMap> = {};
  for (const role of ROLES) {
    const list = desired[role];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      return NextResponse.json({ error: `capabilities.${role} must be an array` }, { status: 400 });
    }
    clean[role] = list.filter(
      (c: unknown): c is Capability =>
        typeof c === "string" && ALL_CAPABILITIES.includes(c as Capability)
    );
  }

  try {
    await saveCapabilities(supabase, id, clean);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save capabilities";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "permissions.changed",
    target: null,
    metadata: { roles: Object.keys(clean) },
  });

  const capabilities = await getEffectiveCapabilities(supabase, id);
  return NextResponse.json({ capabilities });
}
