/**
 * POST /api/integrations/inbound/ghl-custom-field
 *
 * GHL Workflow → webhook when a custom field changes on a contact.
 * Auth: Authorization: Bearer <GHL_INBOUND_SECRET>
 *
 * Expected body (configure in GHL Workflow "Custom Webhook" action):
 *   {
 *     "contactId": "{{contact.id}}",
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
  const fieldName = typeof body.fieldName === "string" ? body.fieldName.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : String(body.value ?? "");

  if (!contactId) {
    return NextResponse.json({ ok: false, error: "missing contactId" }, { status: 400 });
  }

  if (fieldName === "bot_paused") {
    // RADIO field sends "Paused" or "Active"; also accept raw true/false strings.
    const paused = value === "Paused" || value === "true" || value === "1";
    const result = await db
      .update(leads)
      .set({ botPaused: paused })
      .where(eq(leads.ghlContactId, contactId))
      .returning({ sid: leads.manychatSubId });

    if (result.length === 0) {
      console.warn("[ghl-custom-field] no lead found for contactId", contactId);
      return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
    }

    console.log(`[ghl-custom-field] bot_paused=${paused} for lead ${result[0].sid} (GHL ${contactId})`);
    return NextResponse.json({ ok: true, updated: result.length });
  }

  if (fieldName === "follow_up_date") {
    // D2 — accept any ISO date string or empty (clear).
    const dateVal = value || null;
    const result = await db
      .update(leads)
      .set({ followUpDate: dateVal })
      .where(eq(leads.ghlContactId, contactId))
      .returning({ sid: leads.manychatSubId });

    if (result.length === 0) {
      return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, updated: result.length });
  }

  return NextResponse.json({ ok: false, error: `unknown fieldName: ${fieldName}` }, { status: 400 });
}
