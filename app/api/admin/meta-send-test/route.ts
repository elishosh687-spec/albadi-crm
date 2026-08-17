/**
 * POST /api/admin/meta-send-test — fire ONE Meta CRM conversion event for a
 * given lead, to verify the CAPI pipe end-to-end before wiring it to real
 * triggers. Pass a Test Events code (Events Manager → dataset → Test Events tab)
 * so it shows there and does NOT affect live optimization.
 *
 * Auth: Bearer BOT_SECRET.
 * Body: { sid, eventName?, valueIls?, testEventCode? }
 *   sid          — the lead's manychat_sub_id
 *   eventName    — "Qualified" | "QuoteSent" | "Purchase" (default Purchase)
 *   valueIls     — money for Purchase (optional)
 *   testEventCode — Meta Test Events code (recommended)
 */
import { NextRequest, NextResponse } from "next/server";
import { sendMetaCrmEvent, metaCapiConfigured, pingMetaDataset, MetaEventName } from "@/lib/meta/capi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const accepted = [
    process.env.BOT_SECRET,
    process.env.CALL_TRIGGER_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

const VALID: MetaEventName[] = ["Qualified", "QuoteSent", "Purchase"];

/**
 * GET ?ping=1 — is the Meta connection actually alive right now?
 *
 * Reads the dataset back over the Graph API: proves the token is valid and can
 * see THIS dataset, and sends no event. The one-command answer to "how do I
 * know there's really a connection", without opening the ads tab.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const ping = await pingMetaDataset();
  return NextResponse.json(ping, { status: ping.ok ? 200 : 502 });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!metaCapiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "META_CAPI not configured (token/dataset missing)" },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({} as any));
  const sid = String(body.sid ?? "").trim();
  if (!sid) return NextResponse.json({ ok: false, error: "sid required" }, { status: 400 });
  const eventName: MetaEventName = VALID.includes(body.eventName)
    ? body.eventName
    : "Purchase";
  // ?preview=1 (or {preview:true}) builds the payload and returns it WITHOUT
  // sending — use it to see exactly which matching parameters we attach.
  const preview =
    new URL(req.url).searchParams.get("preview") === "1" || body.preview === true;
  const result = await sendMetaCrmEvent(sid, eventName, {
    valueIls: typeof body.valueIls === "number" ? body.valueIls : null,
    testEventCode: body.testEventCode ? String(body.testEventCode) : null,
    // Unique per test call so Meta doesn't dedup repeat verifications.
    eventId: `test:${sid}:${eventName}:${body.testEventCode ?? "live"}`,
    preview,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
