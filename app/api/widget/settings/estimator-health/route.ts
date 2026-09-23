/**
 * GET /api/widget/settings/estimator-health?widget_token=...
 *   → { ok, health: { status, checks[] }, facts }
 *
 * The settings "דיוק המחשבון" screen: is the daily refit running, did it
 * publish, how accurate is it, and what do factory quotes actually teach it.
 * Read-only — never triggers a refit (that one WhatsApps Eli).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { widgetAuthed } from "@/lib/widget/auth";
import { withRequestLog } from "@/lib/observability/log";
import { checkJobs } from "@/lib/observability/jobs";
import { getEstimatorCoeffs } from "@/lib/factory/estimator-config";
import { CURSOR_KEY } from "@/lib/factory/server/refit-estimator";
import { assessEstimatorHealth, type EstimatorHealthInput } from "@/lib/factory/estimator-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog("calculator", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const [{ checks }, coeffs, [cursor]] = await Promise.all([
    checkJobs(),
    getEstimatorCoeffs({ fresh: true }),
    db.select().from(appConfig).where(eq(appConfig.key, CURSOR_KEY)).limit(1),
  ]);
  const job = checks.find((c) => c.job === "refit-estimator");
  const health = assessEstimatorHealth({
    job: { health: job?.health ?? "never", minutesSinceOk: job?.minutesSinceOk ?? null, lastError: job?.state.lastError },
    coeffs,
    lastRefit: (cursor?.value as EstimatorHealthInput["lastRefit"]) ?? null,
  });
  const envelope = Object.values(coeffs.factories).map((f) => [f.areaMin, f.areaMax] as const);
  return NextResponse.json({
    ok: true,
    health,
    facts: {
      factories: Object.keys(coeffs.factories),
      areaMin: Math.min(...envelope.map((e) => e[0])),
      areaMax: Math.max(...envelope.map((e) => e[1])),
      cartonAreaMax: coeffs.carton?.areaMax ?? null,
    },
  });
});
