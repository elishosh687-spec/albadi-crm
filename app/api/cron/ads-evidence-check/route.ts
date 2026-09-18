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
