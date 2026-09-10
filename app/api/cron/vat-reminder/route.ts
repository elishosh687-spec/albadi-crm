/**
 * GET /api/cron/vat-reminder — monthly Vercel cron (10th of each month).
 * WhatsApps Eli a reminder to file VAT. The deadline is the 15th (of the month
 * following the reporting period), so the 10th leaves a few days of slack.
 *
 * Since the move to Invoice4U the authoritative output-VAT figure lives THERE,
 * not in Zoho — the message says exactly which report to open. Full method:
 * zoho project PLAYBOOK.md § דיווח מע"מ + memory `vat-reporting`.
 *
 * Auth: Bearer CRON_SECRET / BOT_SECRET (same as the other crons). Heartbeat
 * via withJob → the watchdog WhatsApps Eli if a month passes with no send.
 * Also POST-able for a manual kick with the same auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendEliDM } from "@/lib/notify/eli";
import { withJob } from "@/lib/observability/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const REMINDER =
  "🧾 תזכורת — דיווח מע\"מ\n\n" +
  "הגיע ה-10 לחודש (הדיווח עד ה-15).\n\n" +
  "מע\"מ עסקאות — המקור הרשמי ב-Invoice4U:\n" +
  "דו״חות → דו״ח הכנסות להנהלת חשבונות → בחר טווח תאריכים → " +
  "סמן חשבוניות מס-קבלה + זיכוי.\n" +
  "השורה \"סה״כ לכלל הדו״ח\" היא המספר (הזיכויים מנוכים אוטומטית).\n\n" +
  "מע\"מ תשומות — תגיד ל-Claude לבדוק בזוהו.\n" +
  "⚠️ אם הגיעה סחורה — מע\"מ היבוא מעמיל המכס הוא תשומה מוכרת, תשמור את המסמכים.\n\n" +
  "תגיד ל-Claude \"תחשב לי מע\"מ\" והוא יעשה את כל החישוב.";

const run = withJob("vat-reminder", "cron", async (req: NextRequest, log) => {
  const jlog = log.child({ job: "vat-reminder" });
  if (!authed(req)) {
    jlog.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await sendEliDM(REMINDER);
  // A reminder that never reached the phone is a failed run — say so with a
  // 5xx, so the heartbeat (withJob) records a failure and the watchdog rings.
  if (result === "no_jid" || result === "error") {
    jlog.error("reminder.not_sent", undefined, { notify: result });
    return NextResponse.json({ ok: false, notify: result }, { status: 500 });
  }
  jlog.info("reminder.sent", { notify: result });
  return NextResponse.json({ ok: true, notify: result });
});

export const GET = run;
export const POST = run;
