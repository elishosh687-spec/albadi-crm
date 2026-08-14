/**
 * POST /api/admin/setter-eval — run the setter's offline evaluation suite.
 *
 * Auth: Bearer BOT_SECRET / CRON_SECRET. Runs every scenario through the real
 * pipeline (needs the prod OpenAI key), grades deterministically, returns the
 * full report including every generated Hebrew message for human review.
 *
 * Query: ?only=price,angry — run a subset.
 * Triggered from the setter-eval GitHub workflow (repo secret carries the
 * auth) or by hand.
 */
import { NextRequest, NextResponse } from "next/server";
import { runLivePathCheck, runSetterEval } from "@/lib/setter/eval";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const accepted = [process.env.BOT_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0 || !accepted.includes(auth ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const only = (req.nextUrl.searchParams.get("only") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    if (req.nextUrl.searchParams.get("livepath") === "1") {
      const live = await runLivePathCheck();
      return NextResponse.json({ ok: true, live });
    }
    const report = await runSetterEval({ only });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
