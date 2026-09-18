/**
 * "מודעות → הגדרות בדיקה" — read and save the ad-recommendation policy.
 *
 * GET  → current policy + revision, the approved defaults (for "reset"), the
 *        consistency warnings, the copyable Markdown and recent revisions.
 * PUT  → { settings, expectedRevision } — 200 saved / 400 Hebrew validation
 *        errors (nothing written) / 409 someone saved first.
 *
 * Recommendation settings only: nothing here can activate, pause or budget a
 * Meta object.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import {
  APPROVED_DEFAULTS_2026_09_18,
  consistencyWarnings,
  settingsToMarkdown,
} from "@/lib/ads/recommendation-settings";
import {
  getAdRecommendationPolicy,
  listPolicyRevisions,
  saveAdRecommendationPolicy,
} from "@/lib/ads/settings-store";

export const dynamic = "force-dynamic";

export const GET = withRequestLog("meta", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const [policy, revisions] = await Promise.all([getAdRecommendationPolicy(), listPolicyRevisions(20)]);
  log.info("ads_settings.read", { revision: policy.revision });
  return NextResponse.json({
    ok: true,
    policy,
    defaults: APPROVED_DEFAULTS_2026_09_18,
    warnings: consistencyWarnings(policy.settings),
    markdown: settingsToMarkdown(policy.settings, policy.revision),
    revisions,
  });
});

export const PUT = withRequestLog("meta", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { settings?: unknown; expectedRevision?: unknown } | null;
  const expected = Number(body?.expectedRevision);
  if (!body || !Number.isInteger(expected) || expected < 0) {
    return NextResponse.json({ ok: false, error: "חסרים settings או expectedRevision" }, { status: 400 });
  }
  const r = await saveAdRecommendationPolicy(body.settings, { expectedRevision: expected, actor: "widget" });
  if (r.ok) {
    return NextResponse.json({
      ok: true,
      policy: r.policy,
      changedKeys: r.changedKeys,
      warnings: consistencyWarnings(r.policy.settings),
      markdown: settingsToMarkdown(r.policy.settings, r.policy.revision),
    });
  }
  switch (r.kind) {
    case "invalid":
      return NextResponse.json({ ok: false, error: "ההגדרות לא נשמרו", errors: r.errors }, { status: 400 });
    case "stale_revision":
      return NextResponse.json(
        { ok: false, error: "ההגדרות השתנו בינתיים; רענן ונסה שוב", currentRevision: r.currentRevision },
        { status: 409 },
      );
    case "no_change":
      return NextResponse.json({ ok: false, error: "אין שינוי לשמור" }, { status: 400 });
  }
});
