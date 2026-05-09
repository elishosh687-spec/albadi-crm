/**
 * Cloud Routine writes Claude's analysis result back to an escalation.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json()) as {
    summary?: string;
    suggested_reply?: string;
    suggested_replies?: { label: string; text: string; reasoning: string }[];
    suggested_tag?: string | null;
    suggested_tag_reason?: string | null;
  };
  const summary = body.summary?.trim();
  const legacyReply = body.suggested_reply?.trim();
  const replies = Array.isArray(body.suggested_replies)
    ? body.suggested_replies
        .filter((r) => r && typeof r.text === "string" && r.text.trim().length > 0)
        .map((r) => ({
          label: String(r.label ?? "אופציה").trim().slice(0, 40),
          text: r.text.trim(),
          reasoning: String(r.reasoning ?? "").trim(),
        }))
        .slice(0, 5)
    : null;

  const VALID_TAGS = [
    "ליד_חדש",
    "מעוניין",
    "הצעה_בוט",
    "הצעה_טלפון",
    "בתהליך",
    "לקוח",
    "לא_ענה",
    "לא_רלוונטי",
  ];
  const rawTag = typeof body.suggested_tag === "string" ? body.suggested_tag.trim() : null;
  const suggestedTag = rawTag && VALID_TAGS.includes(rawTag) ? rawTag : null;
  const suggestedTagReason =
    suggestedTag && typeof body.suggested_tag_reason === "string"
      ? body.suggested_tag_reason.trim().slice(0, 500)
      : null;

  if (!summary) {
    return NextResponse.json({ error: "missing summary" }, { status: 400 });
  }

  await db
    .update(escalations)
    .set({
      analysisSummary: summary,
      suggestedReply: legacyReply ?? null,
      suggestedReplies: replies && replies.length > 0 ? replies : null,
      analyzedAt: new Date(),
      suggestedTag,
      suggestedTagReason,
    })
    .where(eq(escalations.id, id));

  return NextResponse.json({ ok: true });
}
