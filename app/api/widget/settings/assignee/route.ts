/**
 * GET  /api/widget/settings/assignee?widget_token=...
 *   → { ok, users: [{id, name, email}], current: {userId, name} | null, envDefault }
 *   Users come LIVE from GHL so the picker can never drift from the real team.
 *
 * PUT  /api/widget/settings/assignee
 *   single      : { mode?: "single", userId, name? }
 *   round-robin : { mode: "round_robin", rotation: [{userId, name?}, …] }
 *   → who new leads (contact + opportunity owner) and new tasks are assigned to.
 *
 * Eli 2026-08-01: switch the single owner between himself and Itay without a
 * redeploy. Eli 2026-08-03: add "one-by-one" (round_robin) — lead #1 → member A,
 * #2 → member B, and so on.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import {
  loadAssignee,
  setAssignee,
  setRoundRobin,
  type RotationMember,
} from "@/lib/crm-tasks/assignee";
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
  const body = (await req.json().catch(() => ({}))) as {
    mode?: "single" | "round_robin";
    userId?: string;
    name?: string;
    rotation?: RotationMember[];
  };
  try {
    if (body.mode === "round_robin") {
      const rotation = (body.rotation ?? [])
        .filter((m) => m && typeof m.userId === "string" && m.userId.trim())
        .map((m) => ({ userId: m.userId.trim(), name: m.name?.trim() || undefined }));
      if (rotation.length < 2) {
        return NextResponse.json(
          { ok: false, error: "round_robin needs at least 2 people" },
          { status: 400 }
        );
      }
      await setRoundRobin(rotation);
      return NextResponse.json({ ok: true, current: await loadAssignee() });
    }
    const userId = (body.userId ?? "").trim();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "missing userId" }, { status: 400 });
    }
    await setAssignee(userId, body.name?.trim() || undefined);
    return NextResponse.json({ ok: true, current: await loadAssignee() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
