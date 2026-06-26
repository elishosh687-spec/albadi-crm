/**
 * Per-lead deep sales analysis engine — the core of the bottom-up analyzer.
 *
 * analyzeLead(sid):
 *   1. build the lead's dossier (only this lead's own data)
 *   2. skip-if-unchanged via input_hash (cheap re-clicks)
 *   3. LLM "judge" fills a strict structured verdict (closed taxonomy)
 *   4. DETERMINISTIC grounding self-check — drop any objection whose quote is
 *      not actually present in the dossier (the anti-cherry-pick guardrail)
 *   5. map each objection to the Hebrew playbook → reply script
 *   6. persist to lead_analyses + post a GHL contact note
 *
 * The aggregate "why aren't leads closing" report is a deterministic rollup
 * over the persisted verdicts (no second LLM pass), so it cannot fabricate.
 */

import { db } from "@/lib/db";
import { leadAnalyses } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { callLLM } from "@/lib/autoresponder/openai-client";
import { addContactNote, listContactNotes } from "@/integrations/ghl/client";
import {
  OBJECTION_KEYS,
  getObjectionPlay,
  type ObjectionKey,
} from "@/lib/sales/objection-playbook.he";
import {
  buildLeadDossier,
  renderDossierText,
  hashDossier,
  isThinDossier,
  type LeadDossier,
} from "./build-dossier";

export const ANALYSIS_VERSION = "v1";
const NOTE_MARKER_PREFIX = "[LEAD-ANALYSIS v1]";

export type PrimaryBlocker =
  | "price"
  | "moq"
  | "sample_trust"
  | "payment_terms"
  | "product_mismatch"
  | "followup_drop"
  | "spec_open"
  | "wrong_lead"
  | "other";

export interface LeadAnalysisObjection {
  text: string;
  quote: string;
  is_surface_or_root: "surface" | "root";
  taxonomy_key: ObjectionKey;
}

export interface LeadAnalysis {
  sid: string;
  name: string | null;
  stage: string | null;
  insufficient_data: boolean;
  root_cause: string;
  primary_blocker: PrimaryBlocker;
  objections: LeadAnalysisObjection[];
  price_forensics: {
    our_unit: string | null;
    their_alt_unit: string | null;
    branded_vs_unbranded: boolean;
    gulpha_issue: boolean;
  } | null;
  commitment_scorecard: { score_1_5: number; evidence: string };
  intent_signals: string[];
  followup_verdict: {
    promised: boolean;
    delivered: boolean;
    gap_days: number | null;
  } | null;
  sample: { asked: boolean; fulfilled: boolean } | null;
  recommended_next_action: string;
  /** Derived deterministically from the matched playbook key — not the LLM. */
  recommended_reply_script: string;
  confidence: "low" | "medium" | "high";
  /** Meta — transparency on the grounding guardrail. */
  grounding: { dropped_unverified: number };
}

export interface AnalyzeResult {
  verdict: LeadAnalysis;
  cached: boolean;
}

function readEnv(key: string): string {
  return process.env[key] ?? "";
}

const SYSTEM_PROMPT = `אתה אנליסט מכירות בכיר של "אלבדי" — חברה ישראלית שמוכרת שקיות בד אלבד ממותגות (הדפסת לוגו), מיוצרות בסין. יש 128 לידים ומכירה אחת. תפקידך: לנתח ליד אחד בלבד לפי תיק-הליד שמצורף, ולמצוא את שורש התקיעה — לא רק את ההתנגדות השטחית.

חוקי-ברזל:
1. אתה שופט מובנה, לא כותב חופשי. החזר JSON תקין בלבד לפי הסכמה.
2. כל ציטוט (quote) חייב להיות מועתק **מילה במילה** מתוך תיק-הליד. אסור להמציא או לנסח מחדש. אם אין ציטוט מתאים — אל תכלול את ההתנגדות.
3. כל ציטוט וכל טענה מתייחסים אך ורק לליד הזה. אין לך מידע על לידים אחרים.
4. הבחן בין שטח לשורש: "יקר" מול כמות קטנה (MOQ), או מול השוואה לשקית לא-ממותגת, או מול גלופה שכבר שולמה — זה לרוב לא הפסד-מחיר אמיתי.
5. אם אין מספיק דאטה (אין שיחות ומעט הודעות) — החזר insufficient_data=true ושאר השדות מינימליים.

מונחים: "אלבד" = החומר. "גלופה" = עלות חד-פעמית של לוח הדפסה. "שקית/סקית" = המוצר.

מפה כל התנגדות ל-taxonomy_key אחד מהרשימה הסגורה הזו בלבד:
${OBJECTION_KEYS.join(", ")}

החזר JSON במבנה:
{
  "insufficient_data": false,
  "root_cause": "מה באמת תקע את העסקה, משפט-שניים בעברית",
  "primary_blocker": "price|moq|sample_trust|payment_terms|product_mismatch|followup_drop|spec_open|wrong_lead|other",
  "objections": [{"text":"תיאור קצר","quote":"ציטוט מילה במילה מהתיק","is_surface_or_root":"surface|root","taxonomy_key":"<מהרשימה>"}],
  "price_forensics": {"our_unit":"₪ ליחידה שלנו או null","their_alt_unit":"₪ ליחידה של האלטרנטיבה או null","branded_vs_unbranded":true,"gulpha_issue":false} ,
  "commitment_scorecard": {"score_1_5": 3, "evidence":"ציטוט/עובדה קצרה"},
  "intent_signals": ["סיגנל קנייה אם היה"],
  "followup_verdict": {"promised":true,"delivered":false,"gap_days":5},
  "sample": {"asked":false,"fulfilled":false},
  "recommended_next_action": "פעולה אחת קונקרטית בעברית",
  "confidence": "low|medium|high"
}
price_forensics / followup_verdict / sample = null אם לא רלוונטי.`;

export interface RawJudge {
  insufficient_data?: boolean;
  root_cause?: string;
  primary_blocker?: string;
  objections?: {
    text?: string;
    quote?: string;
    is_surface_or_root?: string;
    taxonomy_key?: string;
  }[];
  price_forensics?: LeadAnalysis["price_forensics"];
  commitment_scorecard?: { score_1_5?: number; evidence?: string };
  intent_signals?: string[];
  followup_verdict?: LeadAnalysis["followup_verdict"];
  sample?: LeadAnalysis["sample"];
  recommended_next_action?: string;
  confidence?: string;
}

export async function analyzeLead(
  sid: string,
  opts?: { force?: boolean }
): Promise<AnalyzeResult | null> {
  const dossier = await buildLeadDossier(sid);
  if (!dossier) return null;

  const inputHash = hashDossier(dossier);

  // 2. cache: latest row with same hash → reuse (unless forced).
  if (!opts?.force) {
    const [latest] = await db
      .select()
      .from(leadAnalyses)
      .where(eq(leadAnalyses.manychatSubId, dossier.sid))
      .orderBy(desc(leadAnalyses.createdAt))
      .limit(1);
    if (latest && latest.inputHash === inputHash) {
      return { verdict: latest.verdict as LeadAnalysis, cached: true };
    }
  }

  // 3. thin dossier → no LLM, mark insufficient.
  if (isThinDossier(dossier)) {
    const verdict = thinVerdict(dossier);
    await persist(dossier.sid, verdict, inputHash, "none");
    return { verdict, cached: false };
  }

  // 4. LLM judge.
  const model =
    readEnv("LEAD_ANALYSIS_MODEL") || readEnv("OPENAI_ANALYSIS_MODEL") || "gpt-4o";
  const raw = await callLLM<RawJudge>({
    system: SYSTEM_PROMPT,
    user: renderDossierText(dossier),
    model,
    jsonMode: true,
    timeoutMs: 90_000,
  });

  if (!raw) {
    // Soft-fail: persist a low-confidence stub so the UI shows *something*
    // rather than erroring, and the caller can retry later.
    const verdict = thinVerdict(dossier, "ניתוח אוטומטי נכשל זמנית — נסה שוב.");
    return { verdict, cached: false };
  }

  const verdict = normalizeAndGround(dossier, raw);
  await persist(dossier.sid, verdict, inputHash, model);
  await postGhlNote(dossier, verdict, inputHash);
  return { verdict, cached: false };
}

// ---------------------------------------------------------------------------
// Grounding self-check (the anti-cherry-pick guardrail)
// ---------------------------------------------------------------------------

function normalizeHe(s: string): string {
  return s
    .replace(/[֑-ׇ]/g, "") // niqqud/cantillation
    .replace(/[^א-ת0-9a-zA-Z]+/g, " ") // keep Hebrew/latin/digits
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A quote is grounded if it (or most of its words) appear in the dossier. */
function isGrounded(quote: string, normDossier: string): boolean {
  const nq = normalizeHe(quote);
  if (!nq) return false;
  if (normDossier.includes(nq)) return true;
  const words = nq.split(" ").filter((w) => w.length > 1);
  if (words.length === 0) return false;
  if (words.length < 3) {
    // short quote → require the whole thing present
    return normDossier.includes(nq);
  }
  const hits = words.filter((w) => normDossier.includes(w)).length;
  return hits / words.length >= 0.6;
}

export function normalizeAndGround(d: LeadDossier, raw: RawJudge): LeadAnalysis {
  const normDossier = normalizeHe(renderDossierText(d));

  const rawObjs = Array.isArray(raw.objections) ? raw.objections : [];
  let dropped = 0;
  const objections: LeadAnalysisObjection[] = [];
  for (const o of rawObjs) {
    const quote = (o.quote ?? "").trim();
    const text = (o.text ?? "").trim();
    if (!text) continue;
    if (quote && !isGrounded(quote, normDossier)) {
      dropped++;
      continue; // fabricated / paraphrased quote → drop
    }
    objections.push({
      text,
      quote,
      is_surface_or_root: o.is_surface_or_root === "root" ? "root" : "surface",
      taxonomy_key: coerceKey(o.taxonomy_key),
    });
  }

  // recommended_reply_script: from the primary objection's playbook (root first).
  const lead =
    objections.find((o) => o.is_surface_or_root === "root") ?? objections[0];
  const play = getObjectionPlay(
    lead?.taxonomy_key ?? blockerToKey(raw.primary_blocker)
  );

  return {
    sid: d.sid,
    name: d.name,
    stage: d.stage,
    insufficient_data: !!raw.insufficient_data,
    root_cause: (raw.root_cause ?? "").trim() || "—",
    primary_blocker: coerceBlocker(raw.primary_blocker),
    objections,
    price_forensics: raw.price_forensics ?? null,
    commitment_scorecard: {
      score_1_5: clampScore(raw.commitment_scorecard?.score_1_5),
      evidence: (raw.commitment_scorecard?.evidence ?? "").trim(),
    },
    intent_signals: Array.isArray(raw.intent_signals)
      ? raw.intent_signals.filter(Boolean)
      : [],
    followup_verdict: raw.followup_verdict ?? null,
    sample: raw.sample ?? null,
    recommended_next_action: (raw.recommended_next_action ?? "").trim(),
    recommended_reply_script: play.reply,
    confidence: coerceConfidence(raw.confidence),
    grounding: { dropped_unverified: dropped },
  };
}

function thinVerdict(d: LeadDossier, note?: string): LeadAnalysis {
  return {
    sid: d.sid,
    name: d.name,
    stage: d.stage,
    insufficient_data: true,
    root_cause:
      note ?? "אין מספיק דאטה לניתוח — אין שיחות מתומללות וכמעט אין הודעות.",
    primary_blocker: "other",
    objections: [],
    price_forensics: null,
    commitment_scorecard: { score_1_5: 1, evidence: "" },
    intent_signals: [],
    followup_verdict: null,
    sample: null,
    recommended_next_action:
      d.stats.messageCount === 0
        ? "אין אינטראקציה — בדוק אם הליד אמיתי / צור קשר ראשוני."
        : "אסוף עוד מידע (שיחת בירור) לפני ניתוח.",
    recommended_reply_script: getObjectionPlay("other").reply,
    confidence: "low",
    grounding: { dropped_unverified: 0 },
  };
}

// ---------------------------------------------------------------------------
// Persistence + GHL note
// ---------------------------------------------------------------------------

async function persist(
  sid: string,
  verdict: LeadAnalysis,
  inputHash: string,
  model: string
): Promise<void> {
  await db.insert(leadAnalyses).values({
    manychatSubId: sid,
    verdict,
    inputHash,
    model,
    version: ANALYSIS_VERSION,
  });
}

async function postGhlNote(
  d: LeadDossier,
  verdict: LeadAnalysis,
  inputHash: string
): Promise<void> {
  if (!d.ghlContactId) return;
  const marker = `${NOTE_MARKER_PREFIX} sid=${d.sid} h=${inputHash.slice(0, 8)}`;
  try {
    const existing = await listContactNotes(d.ghlContactId);
    if (existing.some((n) => (n.body ?? "").includes(marker))) return;
    await addContactNote(d.ghlContactId, renderNoteBody(verdict, marker));
  } catch (e) {
    console.error("[analyze-lead] GHL note failed", e);
  }
}

export function renderNoteBody(v: LeadAnalysis, marker: string): string {
  const lines: string[] = [marker, "", `🔍 ניתוח ליד — ${v.name ?? v.sid}`];
  if (v.insufficient_data) {
    lines.push("", "⚠️ אין מספיק דאטה לניתוח מלא.", v.root_cause);
    return lines.join("\n");
  }
  lines.push(
    "",
    `שורש התקיעה: ${v.root_cause}`,
    `חסם מרכזי: ${v.primary_blocker} | מחויבות: ${v.commitment_scorecard.score_1_5}/5 | ביטחון: ${v.confidence}`
  );
  if (v.objections.length) {
    lines.push("", "התנגדויות:");
    v.objections.forEach((o) =>
      lines.push(`• ${o.text}${o.quote ? ` — «${o.quote}»` : ""}`)
    );
  }
  if (v.price_forensics) {
    const p = v.price_forensics;
    lines.push(
      "",
      `מחיר: שלנו ${p.our_unit ?? "?"} מול ${p.their_alt_unit ?? "?"}` +
        (p.gulpha_issue ? " | בעיית גלופה" : "") +
        (p.branded_vs_unbranded ? " | השוואה ממותג↔לא-ממותג" : "")
    );
  }
  if (v.followup_verdict) {
    const f = v.followup_verdict;
    lines.push(
      `follow-up: ${f.promised ? "הבטחנו" : "—"} / ${
        f.delivered ? "מסרנו" : "לא מסרנו"
      }${f.gap_days != null ? ` (פער ${f.gap_days} ימים)` : ""}`
    );
  }
  if (v.sample) {
    lines.push(
      `דוגמה: ${v.sample.asked ? "ביקש" : "לא ביקש"} / ${
        v.sample.fulfilled ? "נשלחה" : "לא נשלחה"
      }`
    );
  }
  lines.push("", `▶ פעולה מומלצת: ${v.recommended_next_action}`);
  lines.push("", `💬 תסריט תשובה:`, v.recommended_reply_script);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function coerceKey(k: string | undefined): ObjectionKey {
  return (OBJECTION_KEYS as string[]).includes(k ?? "")
    ? (k as ObjectionKey)
    : "other";
}

const BLOCKERS: PrimaryBlocker[] = [
  "price",
  "moq",
  "sample_trust",
  "payment_terms",
  "product_mismatch",
  "followup_drop",
  "spec_open",
  "wrong_lead",
  "other",
];

function coerceBlocker(b: string | undefined): PrimaryBlocker {
  return (BLOCKERS as string[]).includes(b ?? "") ? (b as PrimaryBlocker) : "other";
}

function blockerToKey(b: string | undefined): ObjectionKey {
  switch (coerceBlocker(b)) {
    case "price":
      return "price_high_generic";
    case "moq":
      return "moq_too_high";
    case "sample_trust":
      return "sample_trust";
    case "payment_terms":
      return "payment_terms";
    case "product_mismatch":
      return "product_mismatch";
    case "followup_drop":
      return "followup_dropped";
    default:
      return "other";
  }
}

function clampScore(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 1;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function coerceConfidence(c: string | undefined): "low" | "medium" | "high" {
  return c === "high" || c === "medium" ? c : "low";
}
