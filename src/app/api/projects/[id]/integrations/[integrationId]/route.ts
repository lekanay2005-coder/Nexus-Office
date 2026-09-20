import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteIntegrationApiKey } from "@/lib/secrets";
import { logAudit } from "@/lib/audit";
import { getRequireApproval } from "@/lib/capabilities";

// Deleting an integration is a risky production action (Addendum 3): when
// the project has require_approval on, the first call without
// ?confirmed=true returns 409 APPROVAL_REQUIRED plus a summary for the
// confirmation modal. The client shows Approve/Cancel and re-sends with
// confirmed=true. Both outcomes are audit-logged.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id, integrationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const confirmed =
    new URL(req.url).searchParams.get("confirmed") === "true" ||
    (await req.json().catch(() => null))?.confirmed === true;

  const { data: integration } = await supabase
    .from("integrations")
    .select("id, name, type")
    .eq("id", integrationId)
    .eq("project_id", id)
    .maybeSingle();

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  if (!confirmed && (await getRequireApproval(supabase, id))) {
    await logAudit(supabase, {
      projectId: id,
      userId: user.id,
      actor: "user",
      action: "approval.required",
      target: `integration:${integration.name}`,
      metadata: { kind: "integration.delete", type: integration.type },
    });
    return NextResponse.json(
      {
        error: "APPROVAL_REQUIRED",
        approval: {
          kind: "integration.delete",
          title: "Delete integration",
          lines: [
            `Integration: ${integration.name} (${integration.type})`,
            "Its stored API key will be removed from the vault.",
            "AI roles routed to it will fall back to the default provider.",
          ],
        },
      },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("id", integrationId)
    .eq("project_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await deleteIntegrationApiKey(supabase, id, integration.name);
  } catch {
    // Non-fatal — the integration row is already gone.
  }

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "integration.delete",
    target: integration.name,
    metadata: { type: integration.type },
  });

  return NextResponse.json({ ok: true });
}
