/**
 * GET /api/cron/expense-reminder — monthly Vercel cron (3rd of each month; statement arrives on the 2nd).
 * WhatsApps Eli a reminder to upload last month's credit-card statement so the
 * month's business expenses get entered into Zoho. Auth: Bearer CRON_SECRET /
 * BOT_SECRET (same as the other crons).
 *
 * Also POST-able for a manual kick with the same auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const REMINDER =
  "📋 תזכורת חודשית — הוצאות\n\n" +
  "הגיע ה-3 לחודש. תעלה ל-Claude את פירוט האשראי של החודש שעבר, " +
  "ונזין יחד את ההוצאות בזוהו — פריט-פריט, עסקי/פרטי (סקיל: monthly-expenses).";

async function run(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await sendEliDM(REMINDER);
  return NextResponse.json({ ok: true, notify: result });
}

export const GET = run;
export const POST = run;
