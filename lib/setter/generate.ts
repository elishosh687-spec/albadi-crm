/**
 * Setter layer, stage 5 — the Hebrew generator, plus the validator (stage 6).
 *
 * Only here does an LLM write customer-facing words, and it writes inside a
 * frame it didn't choose: the strategy names the goal and moves, the skills
 * carry the tactics, the context carries the facts. Validation is mechanical
 * and runs after — a message that fails is regenerated once with the
 * violations quoted back, then dropped (returning null beats sending junk).
 */
import { callLLM } from "../autoresponder/openai-client";
import { getBotSettings } from "../bot-settings/store";
import type { SalesContext } from "./context";
import type { SalesClassification } from "./classify";
import type { SalesStrategy } from "./strategy";
import { SKILLS, SKILL_SETTING_KEY } from "./skills";
import { proposeCallSlots, describeNow, type CallSlot } from "./slots";

export interface ValidationReport {
  ok: boolean;
  violations: string[];
  wordCount: number;
}

export interface GeneratedMessage {
  text: string;
  validation: ValidationReport;
  attempts: number;
}

export function validateMessage(
  text: string,
  ctx: SalesContext,
  strategy: SalesStrategy,
  maxWords = 60,
  /** The only windows this turn may name. Empty = no hour may be named at all. */
  allowedSlots: CallSlot[] = []
): ValidationReport {
  const violations: string[] = [];
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (!trimmed) violations.push("הודעה ריקה");
  if (words.length > maxWords) violations.push(`ארוכה מדי (${words.length} מילים, מקסימום ${maxWords})`);
  if (!/[֐-׿]/.test(trimmed)) violations.push("לא בעברית");

  const questions = (trimmed.match(/\?/g) ?? []).length;
  if (questions > 1) violations.push(`${questions} שאלות — מותר אחת`);

  // Money guard: every ₪-amount must be a number we actually hold.
  const known = new Set<string>();
  if (ctx.quote.totalIls) {
    known.add(String(Math.round(ctx.quote.totalIls)));
    known.add(ctx.quote.totalIls.toLocaleString("en-US"));
    known.add(ctx.quote.totalIls.toLocaleString("he-IL"));
  }
  for (const m of trimmed.matchAll(/₪\s?([\d.,]+)/g)) {
    const raw = m[1].replace(/[.,]00$/, "");
    if (![...known].some((k) => raw.replace(/,/g, "") === k.replace(/,/g, ""))) {
      violations.push(`מחיר שלא קיים אצלנו: ₪${m[1]}`);
    }
  }

  // Discount guard — the setter has no authority to price.
  if (/הנחה|נוריד את המחיר|מחיר מיוחד/.test(trimmed)) {
    violations.push("מציעה הנחה — אסור");
  }

  // No invented availability. Two separate rules:
  //   1. an hour may only appear when the strategy actually set out to book a
  //      call, and
  //   2. it must be one of the windows code computed for THIS moment.
  // Rule 2 is what stops "היום ב-17:00" going out at 19:20 — the generator no
  // longer chooses hours, it picks from a list, and anything else is rejected
  // and regenerated (and failing that, the canned template is sent instead).
  const times = [...trimmed.matchAll(/\b(\d{1,2}:\d{2})\b/g)].map((m) => m[1]);
  if (times.length && strategy.goal !== "book_call" && strategy.goal !== "revive") {
    violations.push("מציעה שעה למרות שהיעד אינו קביעת שיחה");
  } else if (times.length) {
    // Hebrew text arrives with a maqaf (ב־11:00) where our labels use a plain
    // hyphen; normalise before comparing or every legitimate slot is rejected.
    const flat = trimmed.replace(/[\u05BE\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ");
    const allowedTimes = allowedSlots.map((s) => s.time);
    for (const t of times) {
      const norm = t.length === 4 ? `0${t}` : t;
      if (!allowedTimes.includes(norm)) {
        violations.push(`שעה שלא הוצעה לה: ${t} (מותר רק: ${allowedTimes.join(", ") || "אין"})`);
      }
    }
    // The DAY has to match too. "היום ב-17:00" sent at 19:20 uses a legal hour
    // on a legal (later) day — checking the clock alone would wave it through,
    // which is the exact message that started this.
    const dayMatched = allowedSlots.some((s) => {
      const dayPart = s.label.split(" ב-")[0];
      return flat.includes(dayPart) && flat.includes(s.time);
    });
    if (!dayMatched && !violations.some((v) => v.startsWith("שעה שלא"))) {
      violations.push(
        `היום לא תואם לשעה — מותר רק: ${allowedSlots.map((s) => s.label).join(" / ") || "אין"}`
      );
    }
  }

  if (/http|www\./.test(trimmed)) violations.push("קישור בהודעה — לא בשכבה הזאת");

  return { ok: violations.length === 0, violations, wordCount: words.length };
}

function renderContext(
  ctx: SalesContext,
  strategy: SalesStrategy,
  slots: CallSlot[],
  now: Date
): string {
  const lines = [
    `עכשיו: ${describeNow(now)} (שעון ישראל)`,
    slots.length
      ? `חלונות פנויים לשיחה — השתמש בניסוח הזה מילה במילה, ואל תמציא שעה אחרת: ${slots.map((s) => `"${s.label}"`).join(" · ")}`
      : "אין כרגע חלון פנוי להצעה — אל תנקוב בשום שעה.",
    `שם הלקוח: ${ctx.name ?? "לא ידוע"}`,
    `שלב: ${ctx.stage ?? "שאלון"}`,
    ctx.quote.supersededAtIso
      ? "נשלחה ללקוח הצעה מעודכנת מחוץ לבוט (אלי שלח מחיר בעצמו) — אסור לנקוב בשום סכום, דבר על 'ההצעה ששלחנו' בלי מספר"
      : ctx.quote.sent
        ? `הצעה נשלחה: ₪${ctx.quote.totalIls?.toLocaleString() ?? "?"} לפני ${ctx.timing.hoursSinceLastCustomerMessage ?? "?"} שעות`
        : "עוד לא נשלחה הצעה",
    strategy.informationToRequest.length
      ? `חסר ללקוח לשיחה: ${strategy.informationToRequest.join(", ")}`
      : "יש לו את כל הפרטים",
    ...renderDossier(ctx),
    "",
    "שיחה אחרונה:",
    ...ctx.recentMessages.slice(-6).map((m) => `${m.from === "customer" ? "לקוח" : "אנחנו"}: ${m.text}`),
  ];
  return lines.join("\n");
}

/**
 * Everything known about this lead beyond the chat thread.
 *
 * A phone call where the customer named their objection, Eli's own note, and
 * the stored verdict on why the deal is stuck — all of it already existed and
 * none of it reached the writer. Rendered only when present, so a bare lead
 * costs nothing.
 */
function renderDossier(ctx: SalesContext): string[] {
  const d = ctx.dossier;
  if (!d) return [];
  const out: string[] = [];
  if (d.botSummary) out.push(`סטטוס: ${d.botSummary}`);
  if (d.notes) out.push(`הערות של אלי: ${d.notes}`);
  if (d.verdict?.rootCause) {
    out.push(
      `למה העסקה תקועה: ${d.verdict.rootCause}` +
        (d.verdict.primaryBlocker ? ` (חסם: ${d.verdict.primaryBlocker})` : "") +
        (d.verdict.commitment ? ` · מחויבות ${d.verdict.commitment}/5` : "")
    );
  }
  if (d.lastCall?.summary) {
    const when = d.lastCall.whenIso
      ? new Date(d.lastCall.whenIso).toLocaleDateString("he-IL")
      : "";
    out.push(`שיחת טלפון ${when}: ${d.lastCall.summary}`);
    if (d.lastCall.objections.length) {
      out.push(`  התנגדויות שנאמרו בשיחה: ${d.lastCall.objections.join(" · ")}`);
    }
    if (d.lastCall.nextSteps.length) {
      out.push(`  מה סוכם בשיחה: ${d.lastCall.nextSteps.join(" · ")}`);
    }
  }
  if (out.length) out.unshift("");
  return out;
}

export async function generateMessage(
  ctx: SalesContext,
  cls: SalesClassification,
  strategy: SalesStrategy,
  /** What this particular turn is FOR, when the caller knows better than the
   *  classifier — a scheduled follow-up has a purpose the thread can't show. */
  situation?: string
): Promise<GeneratedMessage | null> {
  const S = await getBotSettings();
  // Guidance comes from the settings screen (Eli edits tactics live); the
  // constants in skills.ts are the defaults the store falls back to.
  const settingsBag = S as unknown as Record<string, unknown>;
  const skillBlocks = strategy.skills
    .map((id) => {
      const override = settingsBag[SKILL_SETTING_KEY[id]];
      const guidance =
        typeof override === "string" && override.trim() ? override : SKILLS[id].guidance;
      return `### ${SKILLS[id].title}\n${guidance}`;
    })
    .join("\n\n");

  const now = new Date();
  // Real windows, computed per lead so two customers don't hear the same hour.
  const slots = await proposeCallSlots(ctx.sid, now);

  const aimWords = Math.max(15, Math.round((S.setterMaxWords * 2) / 3));
  const system =
    "אתה כותב הודעת WhatsApp אחת בעברית עבור אלבדי — שקיות ממותגות לעסקים. " +
    "אתה לא סוגר עסקאות בצ'אט; ההצלחה שלך היא שיחת טלפון קבועה. " +
    `כללי סגנון: ${S.setterStyle} עד ${aimWords} מילים. ` +
    "אסור להמציא מחירים, הנחות, מלאי או עובדות. " +
    // The customer can scroll up. Two nudges built from the same skeleton read
    // as a mailing list, which is exactly what a personal message must not
    // sound like — and it is the failure Eli named: "הוא לא כותב ללקוחות, הוא
    // שולח תבניות".
    "הלקוח רואה את כל ההודעות הקודמות שלנו — אל תחזור על אותו פתיח, אותו מבנה או אותו משפט סיום.\n\n" +
    `## הטקטיקות שלך לתור הזה:\n${skillBlocks}`;

  const user =
    renderContext(ctx, strategy, slots, now) +
    `\n\nניתוח: כוונה=${cls.intent}, סימן קנייה=${cls.buyingSignal}, מוכנות לשיחה=${cls.meetingReadiness}` +
    (cls.objectionType ? `, התנגדות=${cls.objectionType}` : "") +
    `\nיעד: ${strategy.goal}\nעשה: ${strategy.moves.join(" · ")}\nאל תעשה: ${strategy.avoid.join(" · ")}\n` +
    (situation ? `\nההקשר של ההודעה הזו: ${situation}\n` : "") +
    "\n" +
    'כתוב את ההודעה בלבד. החזר JSON: {"message": "..."}';

  let attempts = 0;
  let feedback = "";
  while (attempts < 2) {
    attempts++;
    const res = await callLLM<{ message?: string }>({
      jsonMode: true,
      temperature: 0.5,
      timeoutMs: 15000,
      model: S.setterModel,
      system,
      user: user + feedback,
    });
    const text = res?.message?.trim();
    if (!text) continue;
    const validation = validateMessage(text, ctx, strategy, S.setterMaxWords, slots);
    if (validation.ok) return { text, validation, attempts };
    feedback = `\n\nהניסיון הקודם נפסל: ${validation.violations.join("; ")}. תקן וכתוב מחדש.`;
    if (attempts === 2) return { text, validation, attempts };
  }
  return null;
}
