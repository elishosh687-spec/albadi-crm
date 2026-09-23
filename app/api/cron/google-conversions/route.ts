/**
 * GET /api/cron/google-conversions — daily Vercel cron (07:15 UTC).
 *
 * Reports CRM progress of Google-click leads to Google Ads as offline
 * conversions (lib/google/conversions-run.ts; plan phase 5, Eli 23/09).
 * GOOGLE_CONVERSIONS_MODE: off | validate (default — Google checks, nothing
 * counts) | live. Throws with the Hebrew reason when Google refuses, so the
 * watchdog WhatsApps Eli; a missing Data Manager token is a known,
 * not-yet-authorised state and is reported, not alerted.
 *
 * `?probe=1` sends ONE synthetic event with validateOnly (never counted,
 * whatever the mode) to prove the token, its scopes and the API end to end.
 *
 * Auth: Bearer CRON_SECRET / BOT_SECRET / CALL_TRIGGER_SECRET. POST for a
 * manual kick.
 */
import { NextResponse } from "next/server";
import { withJob } from "@/lib/observability/jobs";
import { runGoogleConversions } from "@/lib/google/conversions-run";
import { dataManagerConfig, ingestEvents } from "@/lib/google/conversions-upload";
import { ingestBody } from "@/lib/google/conversions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: Request): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withJob("google-conversions", "google", async (req, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (new URL(req.url).searchParams.get("probe") === "1") {
    const cfg = dataManagerConfig();
    const now = new Date(Date.now() - 3_600_000);
    const body = ingestBody(cfg.customerId, "7711834479", [{
      conv: { sid: "probe", event: "qualified", actionId: "7711834479", at: now, valueIls: 1, transactionId: `albadi-probe-${Date.now()}` },
      lead: { gclid: "Cj0KCQjwprobeValidateOnly0000", gbraid: null, wbraid: null, email: null, phoneE164: null },
    }], true);
    const r = await ingestEvents(body);
    log.info("google_conversions.probe", { ok: r.ok, reason: r.ok ? null : r.reason });
    return NextResponse.json({ probe: true, validateOnly: true, ...r });
  }
  const r = await runGoogleConversions();
  log.info("google_conversions.done", { ...r, pending: JSON.stringify(r.pending) });
  const authorised = Boolean(dataManagerConfig().refreshToken);
  if (r.failed > 0 && authorised) throw new Error(`דיווח המרות לגוגל: ${r.reason ?? "נכשל"}`);
  return NextResponse.json({ ok: true, authorised, ...r });
});

export const GET = run;
export const POST = run;
