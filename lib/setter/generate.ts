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
  maxWords = 60
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

  // No invented availability: times are allowed only when the strategy booked
  // a call ON PURPOSE. (Real slot feeds arrive in a later phase; until then a
  // suggested hour is a soft commitment Eli can keep, so it's allowed only on
  // book_call goals.)
  const hasTime = /\b\d{1,2}:\d{2}\b/.test(trimmed);
  if (hasTime && strategy.goal !== "book_call" && strategy.goal !== "revive") {
    violations.push("מציעה שעה למרות שהיעד אינו קביעת שיחה");
  }

  if (/http|www\./.test(trimmed)) violations.push("קישור בהודעה — לא בשכבה הזאת");

  return { ok: violations.length === 0, violations, wordCount: words.length };
}

function renderContext(ctx: SalesContext, strategy: SalesStrategy): string {
  const lines = [
    `שם הלקוח: ${ctx.name ?? "לא ידוע"}`,
    `שלב: ${ctx.stage ?? "שאלון"}`,
    ctx.quote.sent
      ? `הצעה נשלחה: ₪${ctx.quote.totalIls?.toLocaleString() ?? "?"} לפני ${ctx.timing.hoursSinceLastCustomerMessage ?? "?"} שעות`
      : "עוד לא נשלחה הצעה",
    strategy.informationToRequest.length
      ? `חסר ללקוח לשיחה: ${strategy.informationToRequest.join(", ")}`
      : "יש לו את כל הפרטים",
    "",
    "שיחה אחרונה:",
    ...ctx.recentMessages.slice(-6).map((m) => `${m.from === "customer" ? "לקוח" : "אנחנו"}: ${m.text}`),
  ];
  return lines.join("\n");
}

export async function generateMessage(
  ctx: SalesContext,
  cls: SalesClassification,
  strategy: SalesStrategy
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

  const aimWords = Math.max(15, Math.round((S.setterMaxWords * 2) / 3));
  const system =
    "אתה כותב הודעת WhatsApp אחת בעברית עבור אלבדי — שקיות ממותגות לעסקים. " +
    "אתה לא סוגר עסקאות בצ'אט; ההצלחה שלך היא שיחת טלפון קבועה. " +
    `כללי סגנון: ${S.setterStyle} עד ${aimWords} מילים. ` +
    "אסור להמציא מחירים, הנחות, מלאי או עובדות.\n\n" +
    `## הטקטיקות שלך לתור הזה:\n${skillBlocks}`;

  const user =
    renderContext(ctx, strategy) +
    `\n\nניתוח: כוונה=${cls.intent}, סימן קנייה=${cls.buyingSignal}, מוכנות לשיחה=${cls.meetingReadiness}` +
    (cls.objectionType ? `, התנגדות=${cls.objectionType}` : "") +
    `\nיעד: ${strategy.goal}\nעשה: ${strategy.moves.join(" · ")}\nאל תעשה: ${strategy.avoid.join(" · ")}\n\n` +
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
    const validation = validateMessage(text, ctx, strategy, S.setterMaxWords);
    if (validation.ok) return { text, validation, attempts };
    feedback = `\n\nהניסיון הקודם נפסל: ${validation.violations.join("; ")}. תקן וכתוב מחדש.`;
    if (attempts === 2) return { text, validation, attempts };
  }
  return null;
}
