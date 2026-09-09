/**
 * POST /api/drafts/:id/approve
 *
 * Approve a pending draft. Sends the (optionally edited) text to the lead via
 * the bridge and marks the draft as sent. Logs the outbound to `messages`
 * with sender='bot' so the conversation thread reflects authorship.
 *
 * Auth: Bearer BOT_SECRET.
 *
 * Body: { edited_text?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { approveDraft } from "@/lib/drafts";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const maxDuration = 15;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export const POST = withRequestLog("bot", async (req: NextRequest, log, ctx: { params: Promise<{ id: string }> }) => {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const draftId = Number(id);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { edited_text?: string } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await approveDraft(
    draftId,
    typeof body.edited_text === "string" ? body.edited_text : undefined
  );

  if (!result.ok) {
    log.warn("draft.approve_rejected", { draftId, error: (result as { error?: string }).error });
    return NextResponse.json(result, { status: 400 });
  }
  log.info("draft.approved", { draftId, edited: typeof body.edited_text === "string" });
  return NextResponse.json(result);
});
