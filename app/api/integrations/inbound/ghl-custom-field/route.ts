/**
 * POST /api/integrations/inbound/ghl-custom-field
 *
 * GHL Workflow → webhook when a custom field changes on a contact.
 * Auth: Authorization: Bearer <GHL_INBOUND_SECRET>
 *
 * Expected body (configure in GHL Workflow "Custom Webhook" action):
 *   {
 *     "contactId": "{{contact.id}}",    // OR omit and use "phone": "{{contact.phone}}" instead
 *     "fieldName": "bot_paused",          // which field changed
 *     "value":     "true" | "false"       // new value as string
 *   }
 *
 * Supported fieldName values:
 *   - "bot_paused"      → updates leads.bot_paused (boolean)
 *   - "follow_up_date"  → updates leads.follow_up_date (ISO date string, future D2)
 *
 * GHL Workflow setup:
 *   Trigger:  "Contact Updated" or "Custom Field Updated" — filter Bot Paused field
 *   Action:   "Webhook" (custom)
 *   Method:   POST
 *   URL:      https://albadi-crm.vercel.app/api/integrations/inbound/ghl-custom-field
 *   Headers:  Authorization: Bearer <GHL_INBOUND_SECRET value>
 *   Body:     (see above JSON template)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { GHL_INBOUND_SECRET } from "@/integrations/ghl/config";
import { applyGhlPause } from "@/lib/autoresponder/bot-pause";

export const runtime = "nodejs";

function verifyAuth(req: NextRequest): boolean {
  if (!GHL_INBOUND_SECRET) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === GHL_INBOUND_SECRET;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  // GHL sometimes sends phone instead (E.164, with or without leading +)
  const rawPhone = typeof body.phone === "string" ? body.phone.trim().replace(/^\+/, "") : "";
  // fieldName + value: prefer URL query params (GHL resolves literal body values as merge tags → empty)
  const fieldName = (req.nextUrl.searchParams.get("field") ?? "")
    || (typeof body.fieldName === "string" ? body.fieldName.trim() : "");
  const value = (req.nextUrl.searchParams.get("value") ?? "")
    || (typeof body.value === "string" ? body.value.trim() : String(body.value ?? ""));

  if (!contactId && !rawPhone) {
    return NextResponse.json({ ok: false, error: "missing contactId or phone" }, { status: 400 });
  }

  // Build where clause: match by GHL contact ID or by phone_e164
  const whereClause = contactId
    ? eq(leads.ghlContactId, contactId)
    : eq(leads.phoneE164, rawPhone);

  // Both radios below land on the same column, so they share one rule:
  // applyGhlPause refuses to lift a pause the CUSTOMER asked for, and clears
  // the reason columns when it does un-pause. Writing bot_paused bare is what
  // left stale reasons behind and re-woke escalated leads.
  if (fieldName === "bot_paused" || fieldName === "lead_owner") {
    const paused =
      fieldName === "lead_owner"
        ? value.includes("Eli")
        : value === "Paused" || value === "true" || value === "1";
    const outcome = await applyGhlPause(whereClause, paused);
    if (outcome === "not_found") {
      console.warn("[ghl-custom-field] no lead found for contactId", contactId);
      return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
    }
    if (outcome === "refused") {
      console.log(
        `[ghl-custom-field] refused to un-pause (${fieldName}=${value}) — the customer asked us to stop`
      );
      return NextResponse.json({ ok: true, updated: 0, refused: "customer_opt_out" });
    }
    console.log(`[ghl-custom-field] ${fieldName}=${value} → paused=${paused} (GHL ${contactId})`);
    return NextResponse.json({ ok: true, updated: 1 });
  }

  if (fieldName === "follow_up_date") {
    // D2 — accept any ISO date string or empty (clear).
    const dateVal = value || null;
    const result = await db
      .update(leads)
      .set({ followUpDate: dateVal })
      .where(whereClause)
      .returning({ sid: leads.manychatSubId });

    if (result.length === 0) {
      return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, updated: result.length });
  }

  return NextResponse.json({ ok: false, error: `unknown fieldName: ${fieldName}` }, { status: 400 });
}
