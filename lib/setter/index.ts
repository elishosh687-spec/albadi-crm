/**
 * Setter layer — entry point + decision log.
 *
 * runSetter executes the whole pipeline (context → classify → strategy →
 * generate → validate) and LOGS every run with everything needed to answer
 * "why did it say that?" months later. It never sends: in shadow mode the
 * caller just stores the result; a later phase may hand the draft to the
 * approval queue.
 */
import { db } from "../db";
import { setterDecisions } from "../../drizzle/schema";
import { buildSalesContext, type SalesContext } from "./context";
import { classifySalesState, type SalesClassification } from "./classify";
import { planStrategy, type SalesStrategy } from "./strategy";
import { generateMessage, type GeneratedMessage } from "./generate";

export interface SetterRun {
  ok: boolean;
  skipped?: string;
  context?: SalesContext;
  classification?: SalesClassification;
  strategy?: SalesStrategy;
  message?: GeneratedMessage | null;
  decisionId?: number;
}

export async function runSetter(
  sid: string,
  trigger: string,
  opts?: { mode?: "shadow" | "preview" | "draft" }
): Promise<SetterRun> {
  const mode = opts?.mode ?? "shadow";

  const context = await buildSalesContext(sid);
  if (!context) return { ok: false, skipped: "no_lead" };

  const classification = await classifySalesState(context);
  const strategy = planStrategy(context, classification);

  // hold_back with nothing to answer = the right move is silence; don't spend
  // a generation call writing a message we wouldn't want sent.
  const message =
    strategy.goal === "hold_back" && classification.intent === "gone_quiet"
      ? null
      : await generateMessage(context, classification, strategy);

  let decisionId: number | undefined;
  try {
    const [row] = await db
      .insert(setterDecisions)
      .values({
        manychatSubId: sid.trim(),
        trigger,
        mode,
        stage: context.stage,
        intent: classification.intent,
        objectionType: classification.objectionType,
        buyingSignal: classification.buyingSignal,
        meetingReadiness: classification.meetingReadiness,
        goal: strategy.goal,
        skills: strategy.skills.join(","),
        draftText: message?.text ?? null,
        validation: message?.validation ?? null,
        context: {
          quote: context.quote,
          missing: context.missingInformation,
          timing: context.timing,
          lastCustomerMessage: context.lastCustomerMessage,
        },
      })
      .returning({ id: setterDecisions.id });
    decisionId = row?.id;
  } catch (e) {
    // Logging must never break the pipeline — but say so loudly.
    console.error("[setter] decision log insert failed", e);
  }

  return { ok: true, context, classification, strategy, message, decisionId };
}
