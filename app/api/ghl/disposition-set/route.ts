/**
 * POST /api/ghl/disposition-set
 *
 * Webhook receiver fired by the GHL "Post-Call Router" workflow whenever Eli
 * picks a Custom Disposition after a call. The workflow's Custom Webhook
 * action posts a JSON body with contact + opportunity + disposition name,
 * and we hand off to `handleDisposition()` which does the actual work
 * (Task creation, stage move, counter bump, DB mirror).
 *
 * --------------------------------------------------------------------------
 * GHL Workflow setup (ONE workflow, ONE trigger, ONE action — 5 min UI work):
 *
 *   Trigger: Call Status / Call Details
 *     Filter:  (leave Custom Disposition blank — we want ALL dispositions)
 *
 *   Action:  Custom Webhook (POST)
 *     URL:     https://albadi-crm.vercel.app/api/ghl/disposition-set
 *     Headers: Authorization: Bearer <BOT_SECRET>
 *              Content-Type: application/json
 *     Body (JSON):
 *       {
 *         "contactId":     "{{contact.id}}",
 *         "opportunityId": "{{opportunity.id}}",
 *         "disposition":   "{{call.disposition}}",
 *         "callId":        "{{call.id}}",
 *         "timestamp":     "{{trigger.timestamp}}"
 *       }
 *
 *   (The exact merge-tag names may vary by GHL UI version — use whatever
 *    "Insert Custom Value" picker shows for contact id, opportunity id,
 *    selected disposition, and call id. The endpoint accepts any keys it
 *    recognizes; missing keys just degrade the action gracefully.)
 * --------------------------------------------------------------------------
 *
 * Auth: Bearer BOT_SECRET (shared with /api/bot/* endpoints).
 * Idempotency: dedupe on bridge_events.evt_id using callId (or a synthetic
 * key if callId absent). GHL sometimes retries — second post becomes a no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bridgeEvents } from "@/drizzle/schema";
import { handleDisposition } from "@/lib/dispositions/handler";
import { findRule } from "@/lib/dispositions/config";

export const runtime = "nodejs";
export const maxDuration = 30;

interface DispositionWebhookBody {
  contactId?: string;
  opportunityId?: string | null;
  disposition?: string;
  callId?: string;
  timestamp?: string;
  // Tolerate extra keys so GHL UI changes don't break us.
  [k: string]: unknown;
}

function unauthorized(reason: string) {
  console.warn(`[ghl.disposition-set] unauthorized: ${reason}`);
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function badRequest(reason: string, extra?: Record<string, unknown>) {
  console.warn(`[ghl.disposition-set] bad request: ${reason}`, extra);
  return NextResponse.json(
    { error: "bad_request", reason, ...extra },
    { status: 400 }
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Accept EITHER:
  //   1. GHL_DISPOSITION_SECRET — dedicated secret for this endpoint (preferred,
  //      because GHL is the only caller and rotating it doesn't affect anything else)
  //   2. BOT_SECRET — fallback so older configs keep working
  const dispositionSecret = process.env.GHL_DISPOSITION_SECRET || "";
  const botSecret = process.env.BOT_SECRET || process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  if (!dispositionSecret && !botSecret) return unauthorized("no secret configured");
  const accepted =
    (dispositionSecret && auth === `Bearer ${dispositionSecret}`) ||
    (botSecret && auth === `Bearer ${botSecret}`);
  if (!accepted) return unauthorized("bad bearer");

  let body: DispositionWebhookBody;
  try {
    body = (await req.json()) as DispositionWebhookBody;
  } catch {
    return badRequest("invalid json");
  }

  // DEBUG: log the FULL body (capped at 4KB) so we can discover which merge
  // tag GHL actually uses for "Custom Disposition Name" — the picker labels
  // vary by GHL version and the names aren't documented. Remove this log
  // once we've stabilized the field discovery path.
  try {
    const bodyStr = JSON.stringify(body);
    console.log(
      `[ghl.disposition-set] RAW_BODY (${bodyStr.length}b): ${bodyStr.slice(0, 4000)}`
    );
  } catch {
    /* ignore */
  }

  // Field discovery — GHL might send the contact id under multiple key names
  // depending on the workflow trigger / standard-data shape. Try them all.
  const pickStr = (...keys: string[]): string => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  const contactId = pickStr(
    "contactId",
    "contact_id",
    "contact.id",
    "id" // when triggered from Contact-level trigger
  );
  const disposition = pickStr(
    "disposition",
    "callDisposition",
    "call_disposition",
    "customDisposition",
    "custom_disposition",
    "dispositionName",
    "disposition_name"
  );
  const opportunityId =
    pickStr("opportunityId", "opportunity_id", "opportunity.id") || null;
  const callId =
    pickStr("callId", "call_id", "messageId", "message_id") || null;

  if (!contactId) {
    console.warn(
      `[ghl.disposition-set] missing contactId — body keys: ${Object.keys(body).join(",")}`
    );
    return NextResponse.json({
      ok: true,
      noop: true,
      reason: "missing_contactId",
      bodyKeys: Object.keys(body),
    });
  }
  if (!disposition) {
    console.warn(
      `[ghl.disposition-set] missing disposition — body keys: ${Object.keys(body).join(",")}`
    );
    return NextResponse.json({
      ok: true,
      noop: true,
      reason: "missing_disposition",
      bodyKeys: Object.keys(body),
      hint: "check GHL workflow Custom Data — add 'disposition' field with merge tag for call disposition name",
    });
  }

  // Quick existence check on rule. If unknown, log and 200 (no retry value).
  const rule = findRule(disposition);
  if (!rule) {
    console.warn(
      `[ghl.disposition-set] unknown disposition "${disposition}" — add to lib/dispositions/config.ts`
    );
    return NextResponse.json({
      ok: true,
      noop: true,
      reason: "unknown_disposition",
      disposition,
    });
  }

  // Idempotency — same call event firing twice (GHL retry / dual workflow
  // entry) becomes a no-op. evt_id collapses on (callId, disposition).
  const evtId = `disposition:${callId || `${contactId}:${disposition}:${body.timestamp || Date.now()}`}`;
  const inserted = await db
    .insert(bridgeEvents)
    .values({
      evtId,
      type: "ghl_disposition",
      tenant: null,
      occurredAt: body.timestamp ? new Date(String(body.timestamp)) : new Date(),
      payload: body as any,
    })
    .onConflictDoNothing({ target: bridgeEvents.evtId })
    .returning({ evtId: bridgeEvents.evtId });
  if (inserted.length === 0) {
    console.log(`[ghl.disposition-set] dedup skip evtId=${evtId}`);
    return NextResponse.json({ ok: true, deduped: true });
  }

  console.log(
    `[ghl.disposition-set] processing disposition="${disposition}" contactId=${contactId} oppId=${opportunityId ?? "none"}`
  );

  try {
    const result = await handleDisposition({
      contactId,
      opportunityId,
      disposition,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error(`[ghl.disposition-set] handler failed`, e);
    return NextResponse.json(
      {
        ok: false,
        error: "handler_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

/**
 * GHL probes the URL with GET during workflow setup. Return 200 + endpoint
 * description so the test passes.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    endpoint: "ghl.disposition-set",
    auth: "Bearer BOT_SECRET",
    expectedBody: {
      contactId: "string (required)",
      opportunityId: "string (optional)",
      disposition: "string (required, must match config.ts)",
      callId: "string (optional, used for dedupe)",
      timestamp: "string (optional)",
    },
  });
}
