/**
 * Webhook receiver for ManyChat → albadi-crm.
 * Configured as an "External Request" action inside ManyChat Flows
 * (Default Reply Flow + outbound Flows). Stores every WhatsApp message
 * exchanged with subscribers into the `messages` table for v2 classifier
 * to read.
 *
 * Auth: x-webhook-secret header OR Authorization: Bearer <secret>.
 *       Secret = MANYCHAT_WEBHOOK_SECRET.
 *
 * Body shape is flexible — ManyChat lets the user template any JSON.
 * Recommended payload (configure in ManyChat External Request):
 *   {
 *     "subscriber_id": "{{user_id}}",
 *     "text":          "{{last_input_text}}",
 *     "direction":     "in"
 *   }
 * For outbound flows, set "direction": "out" and "text" to the message body.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 10;

function authorized(req: NextRequest): boolean {
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-webhook-secret");
  if (headerSecret === secret) return true;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return false;
}

function pickSubscriberId(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  const candidate =
    body.subscriber_id ??
    body.user_id ??
    body.subscriber?.id ??
    body.user?.id ??
    null;
  if (candidate === null || candidate === undefined) return null;
  return String(candidate).trim();
}

function pickText(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  return (
    (typeof body.text === "string" && body.text) ||
    (typeof body.last_input_text === "string" && body.last_input_text) ||
    (typeof body.message === "string" && body.message) ||
    null
  );
}

function pickDirection(body: any): "in" | "out" {
  const d = body?.direction;
  return d === "out" ? "out" : "in";
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sid = pickSubscriberId(body);
  if (!sid) {
    return NextResponse.json({ error: "missing subscriber_id" }, { status: 400 });
  }

  const text = pickText(body);
  const direction = pickDirection(body);

  // Auto-register lead row if first time we see this sub_id.
  const existing = await db
    .select({ id: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.manychatSubId, sid))
    .limit(1);
  if (existing.length === 0) {
    try {
      await db
        .insert(leads)
        .values({ manychatSubId: sid, source: "webhook", active: true });
    } catch {
      // race condition / unique violation — fine, ignore
    }
  }

  const [row] = await db
    .insert(messages)
    .values({
      manychatSubId: sid,
      direction,
      text,
      payload: body as any,
    })
    .returning({ id: messages.id });

  return NextResponse.json({ ok: true, id: row.id });
}
