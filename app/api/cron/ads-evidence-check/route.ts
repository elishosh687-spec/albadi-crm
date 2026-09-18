/**
 * GET /api/cron/ads-evidence-check — daily Vercel cron (06:30 UTC, after the
 * 06:00 Meta attribution enrichment).
 *
 * Builds the ad recommendations exactly as the "מודעות" screen does and FAILS
 * when a connection the screen depends on is broken: no/expired Meta token,
 * a Meta page that did not load, the CRM query, the stored policy. A failure
 * is recorded by withJob, and the job watchdog WhatsApps Eli once per incident
 * (and once on recovery) — with the Hebrew reason, which is why this THROWS
 * rather than answering a bare 5xx.
 *
 * It also fails on any red line of the tab's status strip (checkAdsHealth),
 * so every part of the ads feature reaches WhatsApp, not only Meta reading.
 *
 * Data warnings (a lead without an Ad ID, a name with two IDs) are logs only:
 * they are facts about the data, not a broken connection. A poorly performing
 * ad is never an alert.
 *
 * Auth: Bearer CRON_SECRET / BOT_SECRET / CALL_TRIGGER_SECRET. POST for a
 * manual kick.
 */
import { NextResponse } from "next/server";
import { withJob } from "@/lib/observability/jobs";
import { buildRecommendations } from "@/lib/ads/build-recommendations";
import { checkAdsHealth } from "@/lib/ads/ads-health";

/** Checks this run must not alert on: its own previous result, and jobs the
 *  watchdog already WhatsApps about directly. */
const NOT_ALERTED_HERE = new Set(["meta-read", "job:ads-evidence", "job:enrich-meta-attribution"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: Request): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withJob("ads-evidence", "meta", async (req, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const report = await buildRecommendations({ fresh: true });
  const h = report.health;
  if (!h.meta.ok) {
    throw new Error(`המלצות המודעות: ${h.meta.reason}`);
  }
  // Everything else the מודעות tab's status line checks — CAPI connection,
  // lead→ad attribution, good-lead reporting, Purchase reports — alerts too
  // (Eli, 18/09: "על כל פיצר מודעות … אם משהו לא עובד תכתוב בווצאפ").
  // ponytail: one incident for any mix of problems; a second problem that
  // appears while the first is still open does not re-alert.
  const broken = (await checkAdsHealth()).checks.filter((c) => !c.ok && !NOT_ALERTED_HERE.has(c.key));
  if (broken.length) {
    throw new Error(`מודעות — ${broken.map((c) => `${c.label}: ${c.detail}`).join(" · ")}`);
  }
  const summary = {
    ok: true,
    policyRevision: report.policyRevision,
    ads: report.rows.length,
    metaRows: h.meta.rows,
    counts: report.counts,
    conflicts: report.rows.filter((r) => r.conflict).length,
    unattributedLeads: h.unattributedLeads,
    unknownToMeta: h.unknownToMeta.length,
    nameCollisions: h.nameCollisions.length,
    structureWarnings: report.structure.warnings,
  };
  log.info("ads_evidence.checked", summary);
  return NextResponse.json(summary);
});

export const GET = run;
export const POST = run;
