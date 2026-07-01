/**
 * Pipeline audit — deterministic detection of two failure modes:
 *
 *   1. "נפל בין הכיסאות" — a lead sits in an active stage (NULL / INTAKE /
 *      DISCAVERY / FACTORY_WAIT) but has no OPEN crm_tasks row. Nothing is
 *      scheduled to happen. Rule per Eli: "no task at all" is the bug;
 *      overdue-but-exists is fine (someone will notice).
 *
 *   2. "שלב לא תואם" — the lead's pipeline_stage lags behind what actually
 *      happened. Trigger rules (all DB-only, no LLM):
 *        - DISCAVERY: an analyzed phone call exists (call_recording_imports or
 *          elevenlabs_call_imports with analyzed_at)
 *        - FACTORY_WAIT: a factory_quote_requests row exists
 *        - CONSIDERATION: factory_quote_requests.sent_to_customer_at is set
 *      Highest-priority trigger wins on conflicts.
 *
 * Both outputs are surfaced to Eli for one-click approval — nothing auto-moves.
 */
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  callRecordingImports,
  crmTasks,
  elevenlabsCallImports,
  factoryQuoteRequests,
  leadAnalyses,
  leads,
} from "@/drizzle/schema";
import { normalizeStage, type V2PipelineStage } from "@/lib/manychat/stages";
import type { LeadAnalysis } from "./analyze-lead";

// Stages considered "active" — a lead here should have a next action lined up.
// NULL is included because pre-quote leads legitimately sit at pipeline_stage
// = NULL while the questionnaire is running.
const ACTIVE_STAGES = ["INTAKE", "DISCAVERY", "FACTORY_WAIT"] as const;

export type SuggestedStage = "INTAKE" | "DISCAVERY" | "FACTORY_WAIT" | "CONSIDERATION";

export interface NoTaskRow {
  sid: string;
  name: string | null;
  currentStage: V2PipelineStage | null; // null = בשאלון
  updatedAt: string | null;
}

export interface StageLagRow {
  sid: string;
  name: string | null;
  currentStage: V2PipelineStage | null;
  suggestedStage: SuggestedStage;
  reason: string; // Hebrew, human-readable
  /** Verdict-backed signals shown in the UI so Eli can judge the suggestion. */
  commitmentScore?: number | null; // 1..5, from lead_analyses verdict
  hasAnalysis?: boolean;
}

export interface PipelineAudit {
  noTask: NoTaskRow[];
  stageLag: StageLagRow[];
}

// Order matters — highest wins in the conflict resolver at the bottom.
const STAGE_ORDER: Record<SuggestedStage, number> = {
  INTAKE: 1,
  DISCAVERY: 2,
  FACTORY_WAIT: 3,
  CONSIDERATION: 4,
};

/**
 * Section 1 — active-stage leads with zero OPEN crm_tasks rows.
 * Open = status != 'completed' AND completed_at IS NULL. We accept overdue
 * tasks (the customer of this check is Eli, and overdue is his signal).
 */
async function findLeadsWithoutTasks(): Promise<NoTaskRow[]> {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      stage: leads.pipelineStage,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(
      and(
        eq(leads.active, true),
        or(
          isNull(leads.pipelineStage),
          inArray(leads.pipelineStage, ACTIVE_STAGES as unknown as string[])
        ),
        sql`NOT EXISTS (
          SELECT 1 FROM ${crmTasks}
          WHERE ${crmTasks.manychatSubId} = ${leads.manychatSubId}
            AND ${crmTasks.completedAt} IS NULL
            AND ${crmTasks.status} <> 'completed'
        )`
      )
    );

  return rows.map((r) => ({
    sid: r.sid,
    name: r.name,
    currentStage: normalizeStage(r.stage),
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
}

/**
 * Section 2 — DB signals that outrank the lead's current pipeline_stage.
 *
 * Fetch three signal sets independently, then merge per-sid picking the
 * highest-priority suggested stage. If it matches the current stage → skip.
 */
async function findStageLag(): Promise<StageLagRow[]> {
  // Base set — every active lead. We compare each lead's current stage
  // against the signals below.
  const baseLeads = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      stage: leads.pipelineStage,
    })
    .from(leads)
    .where(eq(leads.active, true));

  const leadIndex = new Map(baseLeads.map((l) => [l.sid, l]));

  // ── Signal: call happened (DISCAVERY trigger) ──────────────────────────
  // GHL native calls: join via ghl_contact_id → leads.ghl_contact_id.
  // ElevenLabs calls: join via phone digits (no sid FK on that side; matches
  // the convention in build-dossier.ts).
  const callSignals = new Map<string, { at: Date }>();

  // Preload sid ↔ ghl_contact_id + sid ↔ phone-digits maps.
  const ghlToSid = new Map<string, string>();
  const phoneToSid = new Map<string, string>();
  const richLeads = await db
    .select({
      sid: leads.manychatSubId,
      ghlContactId: leads.ghlContactId,
      phone: leads.phoneE164,
    })
    .from(leads)
    .where(eq(leads.active, true));
  const digits = (s: string | null | undefined) =>
    (s ?? "").replace(/\D+/g, "");
  for (const l of richLeads) {
    if (l.ghlContactId) ghlToSid.set(l.ghlContactId, l.sid);
    // Phone: strip non-digits and leading zeros; index the full form + last 9.
    const dPhone = digits(l.phone).replace(/^0+/, "");
    if (dPhone.length >= 7) {
      phoneToSid.set(dPhone, l.sid);
      phoneToSid.set(dPhone.slice(-9), l.sid);
    }
    // sid itself often IS a jid containing the phone (972…@c.us).
    const dSid = digits(l.sid).replace(/^0+/, "");
    if (dSid.length >= 7) {
      if (!phoneToSid.has(dSid)) phoneToSid.set(dSid, l.sid);
      if (!phoneToSid.has(dSid.slice(-9))) phoneToSid.set(dSid.slice(-9), l.sid);
    }
  }

  // GHL native call recordings.
  const callRows = await db
    .select({
      ghlContactId: callRecordingImports.ghlContactId,
      at: callRecordingImports.analyzedAt,
    })
    .from(callRecordingImports)
    .where(isNotNull(callRecordingImports.analyzedAt));
  for (const r of callRows) {
    if (!r.at) continue;
    const sid = ghlToSid.get(r.ghlContactId);
    if (!sid) continue;
    const prev = callSignals.get(sid);
    if (!prev || prev.at < r.at) callSignals.set(sid, { at: r.at });
  }

  // ElevenLabs calls — join by phone.
  const elCallRows = await db
    .select({
      phone: elevenlabsCallImports.phone,
      at: elevenlabsCallImports.analyzedAt,
    })
    .from(elevenlabsCallImports)
    .where(isNotNull(elevenlabsCallImports.analyzedAt));
  for (const r of elCallRows) {
    if (!r.phone || !r.at) continue;
    const d = digits(r.phone).replace(/^0+/, "");
    if (!d) continue;
    const sid = phoneToSid.get(d) || phoneToSid.get(d.slice(-9));
    if (!sid) continue;
    const prev = callSignals.get(sid);
    if (!prev || prev.at < r.at) callSignals.set(sid, { at: r.at });
  }

  // ── Signal: factory request exists (FACTORY_WAIT / CONSIDERATION) ──────
  const factorySignals = new Map<
    string,
    { sentToCustomerAt: Date | null; createdAt: Date | null }
  >();
  const factoryRows = await db
    .select({
      sid: factoryQuoteRequests.manychatSubId,
      sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
      createdAt: factoryQuoteRequests.createdAt,
    })
    .from(factoryQuoteRequests);
  for (const r of factoryRows) {
    if (!r.sid) continue;
    const prev = factorySignals.get(r.sid);
    // Keep the "strongest" — a sent PDF beats a pending row.
    if (
      !prev ||
      (r.sentToCustomerAt && !prev.sentToCustomerAt) ||
      (r.createdAt && prev.createdAt && r.createdAt > prev.createdAt)
    ) {
      factorySignals.set(r.sid, {
        sentToCustomerAt: r.sentToCustomerAt,
        createdAt: r.createdAt,
      });
    }
  }

  // ── Signal: LLM verdict (lead_analyses) — the tie-breaker on soft cases ──
  // A DB signal (call ringing, factory row) doesn't prove the customer is
  // actually engaged. The verdict does: gpt-4o read every message + transcript
  // and scored commitment 1-5. We use it to gate suggestions on soft evidence.
  const verdictBySid = new Map<
    string,
    { verdict: LeadAnalysis; createdAt: Date }
  >();
  const verdictRows = await db
    .select({
      sid: leadAnalyses.manychatSubId,
      verdict: leadAnalyses.verdict,
      createdAt: leadAnalyses.createdAt,
    })
    .from(leadAnalyses);
  for (const r of verdictRows) {
    const v = r.verdict as LeadAnalysis | null;
    if (!v || !r.createdAt) continue;
    const prev = verdictBySid.get(r.sid);
    if (!prev || prev.createdAt < r.createdAt) {
      verdictBySid.set(r.sid, { verdict: v, createdAt: r.createdAt });
    }
  }

  // ── Merge per-lead ────────────────────────────────────────────────────
  const out: StageLagRow[] = [];
  for (const l of baseLeads) {
    const current = normalizeStage(l.stage);
    // Skip terminal + side stages — Eli owns those manually.
    if (current === "WON" || current === "LOST") continue;

    const vRow = verdictBySid.get(l.sid);
    const verdict = vRow?.verdict;
    const commitment = verdict?.commitment_scorecard?.score_1_5 ?? null;
    // "Cold" leads (insufficient data or commitment ≤ 1) — customer isn't
    // really engaged. Keep them in INTAKE regardless of DB signals — a call
    // that didn't reach the customer, or a PDF that got no reply, isn't a
    // reason to move the stage.
    const isCold =
      !verdict ||
      verdict.insufficient_data === true ||
      (commitment !== null && commitment <= 1);

    let suggested: SuggestedStage | null = null;
    let reason = "";

    const factory = factorySignals.get(l.sid);
    const call = callSignals.get(l.sid);

    if (factory?.sentToCustomerAt) {
      // CONSIDERATION requires: PDF sent + verdict shows the customer is
      // actually weighing it (commitment ≥ 3, or a money/timing objection).
      const blocker = verdict?.primary_blocker ?? null;
      const weighingBlocker =
        blocker === "price" ||
        blocker === "payment_terms" ||
        blocker === "moq" ||
        blocker === "spec_open";
      if ((commitment ?? 0) >= 3 || weighingBlocker) {
        suggested = "CONSIDERATION";
        reason = `PDF ללקוח (${factory.sentToCustomerAt
          .toISOString()
          .slice(0, 10)}) + הלקוח שוקל${
          blocker ? ` (${blockerLabel(blocker)})` : ""
        }`;
      } else if (!isCold) {
        // Have the PDF but no clear weighing signal → still worth moving to
        // FACTORY_WAIT so the operator sees it isn't stuck at INTAKE.
        suggested = "FACTORY_WAIT";
        reason = `PDF נשלח (${factory.sentToCustomerAt
          .toISOString()
          .slice(0, 10)}) — עדיין לא עוד ברור אם הלקוח שוקל`;
      }
    } else if (factory) {
      // FACTORY_WAIT — factory request exists. Need at least basic engagement
      // otherwise we're routing dead leads through the factory queue.
      if (!isCold) {
        suggested = "FACTORY_WAIT";
        reason = factory.createdAt
          ? `נשלחה בקשה למפעל (${factory.createdAt
              .toISOString()
              .slice(0, 10)})`
          : "נשלחה בקשה למפעל";
      }
    } else if (call) {
      // DISCAVERY — a call happened. Only suggest it if the analyst confirms
      // real engagement in that call (or in later messages).
      if (!isCold && (commitment ?? 0) >= 2) {
        suggested = "DISCAVERY";
        reason = `שיחת טלפון (${call.at
          .toISOString()
          .slice(0, 10)}) + הלקוח בשיחה של ממש`;
      }
    }
    // INTAKE never auto-suggested — see spec.

    if (!suggested) continue;
    // No lag if the current stage is already at or beyond the suggestion.
    const currentRank = current
      ? STAGE_ORDER[current as SuggestedStage] ?? 0
      : 0;
    if (currentRank >= STAGE_ORDER[suggested]) continue;

    out.push({
      sid: l.sid,
      name: l.name,
      currentStage: current,
      suggestedStage: suggested,
      reason,
      commitmentScore: commitment,
      hasAnalysis: !!verdict,
    });
  }
  return out;
}

function blockerLabel(b: string): string {
  const map: Record<string, string> = {
    price: "מחיר",
    moq: "כמות מינימלית",
    sample_trust: "רוצה לראות דוגמה",
    payment_terms: "תנאי תשלום",
    product_mismatch: "מוצר לא מתאים",
    followup_drop: "לא חזר אחרי פולואפ",
    spec_open: "מפרט פתוח",
    wrong_lead: "לא רלוונטי",
    other: "אחר",
  };
  return map[b] ?? b;
}

export async function runPipelineAudit(): Promise<PipelineAudit> {
  const [noTask, stageLag] = await Promise.all([
    findLeadsWithoutTasks(),
    findStageLag(),
  ]);
  return { noTask, stageLag };
}
