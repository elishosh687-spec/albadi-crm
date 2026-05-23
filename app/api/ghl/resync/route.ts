/**
 * POST /api/ghl/resync
 *
 * Legacy entry: GHL Workflow webhooks (UI-configured) POST here with
 * { contactId }. All resync logic lives in lib/ghl/resync-helper.ts and
 * is shared with the newer /api/ghl/app-webhook (Marketplace App native
 * webhooks). Once Eli flips off the legacy workflows, this route can be
 * deleted.
 *
 * Auth: Authorization: Bearer <BOT_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { resyncContact } from "@/lib/ghl/resync-helper";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.BOT_SECRET || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  let payload: { contactId?: string; contact_id?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const contactId = payload.contactId || payload.contact_id;
  if (!contactId) {
    return NextResponse.json({ error: "missing_contactId" }, { status: 400 });
  }

  const result = await resyncContact(contactId, "ghl_workflow");
  if (!result.ok) {
    const status = result.error === "no_lead_matched" ? 404 : 502;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
