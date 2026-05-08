import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json() as { subscriber_id?: string; name?: string };
  if (!body.subscriber_id) {
    return NextResponse.json({ error: "missing subscriber_id" }, { status: 400 });
  }
  await db.insert(leads).values({
    manychatSubId: body.subscriber_id,
    name: body.name ?? null,
    source: "manychat_webhook",
  }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}
