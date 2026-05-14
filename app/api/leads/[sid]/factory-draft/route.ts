/**
 * PUT /api/leads/[sid]/factory-draft
 * DELETE /api/leads/[sid]/factory-draft
 *
 * Stores a manually-entered factory spec draft on the lead row. Used so Eli can
 * fill the inline manual form, push it to the order-summary panel, optionally
 * add notes, and only then send to Feishu. The draft is cleared automatically
 * when /api/factory/quote-request succeeds.
 *
 * Auth: dashboard cookie (middleware.ts protects /api/actions/* but not this
 * path — we add cookie check inline).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

const DraftSchema = z.object({
  description: z.string().default(""),
  material: z.string().default(""),
  widthCm: z.number().nonnegative().default(0),
  heightCm: z.number().nonnegative().default(0),
  depthCm: z.number().nonnegative().default(0),
  quantity: z.number().int().nonnegative().default(0),
  printing: z.string().default(""),
  finishing: z.string().default(""),
  notes: z.string().default(""),
});

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sid } = await params;
  let body: z.infer<typeof DraftSchema>;
  try {
    body = DraftSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  await db
    .update(leads)
    .set({ factorySpecDraft: body, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`);

  return NextResponse.json({ ok: true, draft: body });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sid } = await params;
  await db
    .update(leads)
    .set({ factorySpecDraft: null, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`);
  return NextResponse.json({ ok: true });
}
