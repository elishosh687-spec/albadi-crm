/**
 * PUT/DELETE /api/widget/leads/[sid]/factory-draft?widget_token=...
 * Same shape as /api/leads/[sid]/factory-draft but auth'd by widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { widgetAuthed } from "@/lib/widget/auth";

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

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ sid: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { sid } = await ctx.params;
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
  ctx: { params: Promise<{ sid: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { sid } = await ctx.params;
  await db
    .update(leads)
    .set({ factorySpecDraft: null, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`);
  return NextResponse.json({ ok: true });
}
