/**
 * Bot playground API — runs the REAL bot handlers against a disposable lead,
 * with every outbound intercepted so nothing reaches WhatsApp.
 *
 * GET  → transcript + lead state + effective settings
 * POST → { action: "send", text } | { action: "reset" }
 *
 * Routing mirrors app/api/greenapi/webhook/route.ts (the questionnaireActive
 * check and the stage branch) so playground behaviour matches production. The
 * gates that precede it in the webhook — stop-word, sticky bot-pause, the
 * 7-day conversation reset, the supervisor dispatcher — are deliberately
 * skipped: the point is to exercise the bot, not the guard rails around it.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { runCaptured } from "@/lib/bot-playground/capture";
import {
  PLAYGROUND_SID,
  ensurePlaygroundLead,
  loadLeadState,
  loadTranscript,
  recordCaptured,
  recordInbound,
  resetPlayground,
} from "@/lib/bot-playground/session";
import { loadEffectiveSettings } from "@/lib/bot-playground/settings";
import { handleInbound } from "@/lib/autoresponder/questionnaire";
import { handleDecisionInbound } from "@/lib/autoresponder/decision";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) return unauthorized();

  await ensurePlaygroundLead();
  const [transcript, lead, settings] = await Promise.all([
    loadTranscript(),
    loadLeadState(),
    loadEffectiveSettings(),
  ]);
  return NextResponse.json({ ok: true, transcript, lead, settings });
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    text?: string;
  };

  if (body.action === "reset") {
    await resetPlayground();
    const [transcript, lead] = await Promise.all([loadTranscript(), loadLeadState()]);
    return NextResponse.json({ ok: true, transcript, lead });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty_text" }, { status: 400 });
  }

  await ensurePlaygroundLead();
  await recordInbound(text);

  // Decide which handler owns this turn — same rule as the webhook.
  const before = await loadLeadState();
  const q = before.qState as { step?: number; doneAt?: unknown; bailed?: unknown } | null;
  const questionnaireActive =
    !!q && typeof q.step === "number" && q.step <= 9 && !q.doneAt && !q.bailed;
  const stage = (before.pipelineStage ?? "").toUpperCase() || null;

  let routedTo: "questionnaire" | "decision" | "none" = "none";
  let handlerResult: unknown = null;
  let error: string | null = null;

  const { sends } = await runCaptured(async () => {
    try {
      if (questionnaireActive || !stage) {
        routedTo = "questionnaire";
        handlerResult = await handleInbound({ sid: PLAYGROUND_SID, text });
      } else if (
        stage === "INTAKE" ||
        stage === "FACTORY_WAIT" ||
        stage === "CONSIDERATION" ||
        stage === "DISCAVERY"
      ) {
        routedTo = "decision";
        handlerResult = await handleDecisionInbound({
          sid: PLAYGROUND_SID,
          text,
          hasMedia: false,
        });
      }
      // WON / LOST → no-op, same as production.
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.error("[playground] handler error", e);
    }
  });

  await recordCaptured(sends);

  const [transcript, lead] = await Promise.all([loadTranscript(), loadLeadState()]);
  return NextResponse.json({
    ok: !error,
    error,
    routedTo,
    handlerResult,
    sentCount: sends.length,
    transcript,
    lead,
  });
}
