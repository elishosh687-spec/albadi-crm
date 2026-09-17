import { NextRequest, NextResponse } from "next/server";
import { analyzeCall } from "@/lib/autoresponder/call-analysis";
import { getBotSettings } from "@/lib/bot-settings/store";
import { evaluateCallAction } from "@/lib/calls/action-policy";
import { buildCallAnalysisNote } from "@/lib/calls/note-builder";
import { evaluateStatusRecommendation } from "@/lib/calls/status-policy";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";
export const maxDuration = 90;

export const POST = withRequestLog("widget", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    transcript?: string;
    callStartedAt?: string;
  };
  const transcript = body.transcript?.trim() ?? "";
  if (transcript.length < 10 || transcript.length > 80_000) {
    return NextResponse.json(
      { ok: false, error: "נדרש תמלול באורך 10 עד 80,000 תווים" },
      { status: 400 },
    );
  }
  const parsedStart = body.callStartedAt ? new Date(body.callStartedAt) : new Date();
  const callStartedAt = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
  const [analysis, settings] = await Promise.all([
    analyzeCall(transcript, { callStartedAt }),
    getBotSettings(),
  ]);
  if (!analysis) {
    return NextResponse.json({ ok: false, error: "המודל לא החזיר ניתוח תקין" }, { status: 502 });
  }
  const policy = evaluateCallAction({
    analysis,
    settings,
    callStartedAt,
    // Preview has no contact. This flag lets the operator inspect the remaining
    // gates without making any GHL lookup or write.
    assigneeResolved: true,
  });
  const statusPolicy = evaluateStatusRecommendation({
    analysis,
    settings,
    noResponseCallCount: 0,
    noResponseWhatsappCount: 0,
    explicitLostSignal: false,
  });
  const note = buildCallAnalysisNote({
    marker: "[PREVIEW — לא נכתב ל-GHL]",
    sourceLabel: "תצוגה מקדימה",
    startedAt: callStartedAt,
    durationSec: null,
    analysis,
    transcript,
    settings,
  });
  log.info("call_analysis.previewed", {
    transcriptLength: transcript.length,
    decision: policy.decision,
    reason: policy.reason,
  });
  return NextResponse.json({ ok: true, analysis, policy, statusPolicy, note });
});
