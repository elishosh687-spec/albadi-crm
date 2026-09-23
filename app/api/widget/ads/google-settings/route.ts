/**
 * "הגדרות ← שיווק · גוגל" — read and save the Google Ads settings of the CRM.
 *
 * GET  → current settings + revision, defaults (for "reset"), warnings,
 *        Markdown, history.
 * PUT  → { settings, expectedRevision } — 200 saved / 400 Hebrew validation
 *        errors (nothing written) / 409 someone saved first.
 *
 * Alerts and displayed metrics only: nothing here touches Google Ads.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { GOOGLE_DEFAULTS_2026_09_23, googleConsistencyWarnings, googleSettingsToMarkdown } from "@/lib/ads/google-settings";
import { getGooglePolicy, saveGooglePolicy } from "@/lib/ads/google-settings-store";

export const dynamic = "force-dynamic";

export const GET = withRequestLog("google", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const policy = await getGooglePolicy();
  return NextResponse.json({
    ok: true,
    policy,
    defaults: GOOGLE_DEFAULTS_2026_09_23,
    warnings: googleConsistencyWarnings(policy.settings),
    markdown: googleSettingsToMarkdown(policy.settings, policy.revision),
  });
});

export const PUT = withRequestLog("google", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { settings?: unknown; expectedRevision?: unknown } | null;
  const expected = Number(body?.expectedRevision);
  if (!body || !Number.isInteger(expected) || expected < 0) {
    return NextResponse.json({ ok: false, error: "חסרים settings או expectedRevision" }, { status: 400 });
  }
  const r = await saveGooglePolicy(body.settings, { expectedRevision: expected, actor: "widget" });
  if (r.ok) {
    return NextResponse.json({
      ok: true,
      policy: r.policy,
      changedKeys: r.changedKeys,
      warnings: googleConsistencyWarnings(r.policy.settings),
      markdown: googleSettingsToMarkdown(r.policy.settings, r.policy.revision),
    });
  }
  switch (r.kind) {
    case "invalid":
      return NextResponse.json({ ok: false, error: "ההגדרות לא נשמרו", errors: r.errors }, { status: 400 });
    case "stale_revision":
      return NextResponse.json({ ok: false, error: "ההגדרות השתנו בינתיים; רענן ונסה שוב", currentRevision: r.currentRevision }, { status: 409 });
    case "no_change":
      return NextResponse.json({ ok: false, error: "אין שינוי לשמור" }, { status: 400 });
  }
});
