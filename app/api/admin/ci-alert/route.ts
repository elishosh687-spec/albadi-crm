/**
 * POST /api/admin/ci-alert — GitHub Actions calls this when the test workflow
 * fails on `main` (.github/workflows/test.yml), and it WhatsApps Eli. Project
 * rule: a serious failure without a WhatsApp is worthless — never email.
 *
 * Auth: Bearer BOT_SECRET / CRON_SECRET / CALL_TRIGGER_SECRET (same set as the
 * job watchdog; CALL_TRIGGER_SECRET is the one Actions holds).
 * Body: { workflow?, sha?, run_url?, message?, status?: "failure" | "success" }
 * `?dry=1` returns the composed text without sending.
 *
 * Not a scheduled job → withRequestLog, not withJob, and no JOBS entry.
 * `/api/admin/*` is outside the middleware matcher, so the bearer check here is
 * the only gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const accepted = [process.env.BOT_SECRET, process.env.CRON_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

interface CiAlertBody {
  workflow?: string;
  sha?: string;
  run_url?: string;
  message?: string;
  status?: "failure" | "success";
}

export function composeCiAlert(b: CiAlertBody): string {
  const sha = (b.sha ?? "").slice(0, 7) || "?";
  const firstLine = (b.message ?? "").split("\n")[0].trim().slice(0, 80);
  const head =
    b.status === "success"
      ? "✅ הטסטים חזרו לירוק ב-main"
      : `❌ טסטים נכשלו ב-main (${b.workflow ?? "test"})`;
  const lines = [head, `${sha}${firstLine ? ` · ${firstLine}` : ""}`];
  if (b.run_url) lines.push(b.run_url);
  return lines.join("\n");
}

export const POST = withRequestLog<NextRequest>("admin", async (req, log) => {
  if (!authorized(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: CiAlertBody;
  try {
    body = (await req.json()) as CiAlertBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const text = composeCiAlert(body ?? {});
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (dry) return NextResponse.json({ ok: true, dry: true, text });

  const result = await sendEliDM(text);
  log.info("ci_alert.sent", { workflow: body?.workflow, sha: body?.sha, status: body?.status, result });
  return NextResponse.json({ ok: result === "sent" || result === "dry_run", result, text });
});
