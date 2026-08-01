/**
 * GET  /api/widget/settings/assignee?widget_token=...
 *   → { ok, users: [{id, name, email}], current: {userId, name} | null, envDefault }
 *   Users come LIVE from GHL so the picker can never drift from the real team.
 *
 * PUT  /api/widget/settings/assignee  { userId, name? }
 *   → who new leads (contact + opportunity owner) and new tasks are assigned to.
 *
 * Eli 2026-08-01: everything used to be hardwired to Itay; he wants to switch it
 * between himself and Itay without a redeploy.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { loadAssignee, setAssignee } from "@/lib/crm-tasks/assignee";
import { listLocationUsers } from "@/integrations/ghl/client";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const current = await loadAssignee();
  // A GHL outage must not blank the screen — fall back to an empty roster and
  // let the UI show the stored selection on its own.
  const users = await listLocationUsers().catch((err) => {
    console.warn("[settings/assignee] GHL user list failed (non-fatal)", err);
    return [] as Awaited<ReturnType<typeof listLocationUsers>>;
  });
  return NextResponse.json({
    ok: true,
    users,
    current,
    envDefault: GHL_SALESPERSON_USER_ID || null,
  });
}

export async function PUT(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { userId?: string; name?: string };
  const userId = (body.userId ?? "").trim();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "missing userId" }, { status: 400 });
  }
  try {
    await setAssignee(userId, body.name?.trim() || undefined);
    return NextResponse.json({ ok: true, current: await loadAssignee() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
