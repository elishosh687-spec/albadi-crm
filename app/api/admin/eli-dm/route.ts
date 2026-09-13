/**
 * POST /api/admin/eli-dm — say something to Eli on WhatsApp from outside the
 * cluster. Built so a Claude session can answer him in the thread he already
 * reads (`scripts/eli-inbox.ts say`), which is the only channel he trusts for
 * anything operational: "לוגים רציניים בלי התראה זה לא שווה, ורק בוואטסאפ".
 *
 * Why a route and not a local send: `ELI_NOTIFY_JID` and the GreenAPI
 * credentials are Production-scoped, and `vercel env pull` masks them to "" —
 * so a laptop cannot send at all. This is the bridge, and it keeps the
 * credentials where they belong.
 *
 * ⚠️ THE RECIPIENT IS NOT A PARAMETER, DELIBERATELY. It always and only goes
 * to ELI_NOTIFY_JID, so even a leaked secret can text Eli and nobody else —
 * never a customer. Don't "generalise" this into a send-to-anyone endpoint;
 * customer sends have their own audited paths (`sendBridgeMessage`,
 * `sendTeamDM`) that attribute the sender and record the message.
 *
 * Auth: Bearer BOT_SECRET / CRON_SECRET / CALL_TRIGGER_SECRET (same set as
 * /api/admin/ci-alert). `/api/admin/*` is outside the middleware matcher, so
 * this check is the only gate.
 * Body: { text: string }   ·   `?dry=1` echoes the text and sends nothing.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WhatsApp rejects very long bodies, and a runaway caller shouldn't spam him. */
const MAX_CHARS = 3000;

function authorized(req: NextRequest): boolean {
  const accepted = [process.env.BOT_SECRET, process.env.CRON_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

export const POST = withRequestLog<NextRequest>("admin", async (req, log) => {
  if (!authorized(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, error: "text_required" }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ ok: false, error: "text_too_long", max: MAX_CHARS }, { status: 400 });
  }

  if (new URL(req.url).searchParams.get("dry") === "1") {
    return NextResponse.json({ ok: true, dry: true, text });
  }

  const result = await sendEliDM(text);
  log.info("eli_dm.api_sent", { chars: text.length, result });
  return NextResponse.json({ ok: result === "sent" || result === "dry_run", result });
});
