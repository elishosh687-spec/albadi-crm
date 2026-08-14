/**
 * Setter offline evaluation — the test harness from the Setter plan.
 *
 * Each scenario builds a disposable eval lead (a post-quote conversation with
 * the scenario's customer message on top), runs the REAL pipeline
 * (classify → route → generate → validate), and grades the run:
 *   - was the intent read correctly?
 *   - did the router pick the right goal?
 *   - did the message pass validation, and does it avoid the scenario's
 *     forbidden content (discount promises, sample promises, pushing an angry
 *     customer)?
 *
 * Hebrew NATURALNESS is deliberately not machine-graded — every generated
 * message is returned in the report for Eli to judge. What only he can grade
 * is left to him; what a machine can grade is enforced.
 *
 * Runs in prod (needs the OpenAI key) via /api/admin/setter-eval; eval leads
 * are prefixed `evaltest:` and deleted at the end.
 */
import { db } from "../db";
import { leads, messages } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
import { runSetter } from "./index";

interface Scenario {
  slug: string;
  name: string;
  /** The customer's final message. Empty = silence scenario. */
  customerText: string;
  /** Hours to age the whole conversation (silence scenarios). */
  ageHours?: number;
  expect: {
    intents: string[];
    goals: string[];
    /** When true a message must exist and pass validation. */
    wantsMessage: boolean;
    /** Regexes that must NOT appear in the message. */
    mustNotMatch?: { re: string; why: string }[];
    /** At least one of these regexes must appear (when a message exists). */
    shouldMatchAny?: { re: string; why: string }[];
  };
}

export const SCENARIOS: Scenario[] = [
  {
    slug: "price",
    name: "התנגדות מחיר",
    customerText: "יקר לי",
    expect: {
      intents: ["objecting"],
      goals: ["explore_objection"],
      wantsMessage: true,
      mustNotMatch: [
        { re: "הנחה|מחיר מיוחד", why: "אסור להציע הנחה" },
        { re: "איכות|משתלם מאוד", why: "לא להצדיק מחיר לפני בירור" },
      ],
      shouldMatchAny: [{ re: "\\?", why: "חייבת שאלה שמבררת את ההתנגדות" }],
    },
  },
  {
    slug: "price-typo",
    name: "התנגדות מחיר בסלנג",
    customerText: "יקררר",
    expect: { intents: ["objecting"], goals: ["explore_objection"], wantsMessage: true },
  },
  {
    slug: "competitor",
    name: "מתחרה זול יותר",
    customerText: "קיבלתי הצעה יותר זולה ממקום אחר",
    expect: {
      intents: ["objecting"],
      goals: ["explore_objection"],
      wantsMessage: true,
      mustNotMatch: [{ re: "הנחה|נשווה את המחיר|נוריד", why: "לא מתמחרים בצ'אט" }],
    },
  },
  {
    slug: "discount",
    name: "בקשת הנחה",
    customerText: "יש מצב לעשות לי מחיר טוב יותר?",
    expect: {
      intents: ["objecting", "considering"],
      goals: ["explore_objection", "answer_and_advance"],
      wantsMessage: true,
      mustNotMatch: [{ re: "הנחה של|נוריד|מחיר מיוחד|אחוז", why: "אסור להבטיח הנחה" }],
    },
  },
  {
    slug: "sample",
    name: "בקשת דוגמה פיזית",
    customerText: "אפשר לקבל דוגמה של השקית לפני שאני מחליט?",
    expect: {
      intents: ["asking_question", "considering", "objecting"],
      goals: ["answer_and_advance", "explore_objection"],
      wantsMessage: true,
      // Business rule: Albadi does NOT send physical samples. A promise here
      // is a hallucination with a real-world cost.
      mustNotMatch: [{ re: "נשלח לך דוגמה|דוגמה פיזית בדרך|נשלח אליך שקית", why: "אין דוגמאות פיזיות — כלל עסקי" }],
    },
  },
  {
    slug: "delivery",
    name: "שאלת משלוח אחרי הצעה",
    customerText: "כמה זמן לוקח המשלוח?",
    expect: {
      intents: ["asking_question"],
      goals: ["answer_and_advance"],
      wantsMessage: true,
      shouldMatchAny: [{ re: "שיחה|נתקשר|להתקשר|טלפון", why: "אחרי הצעה חייב לכוון לשיחה" }],
    },
  },
  {
    slug: "busy",
    name: "מעוניין אבל עסוק",
    customerText: "מעניין אותי אבל אני מפוצץ השבוע",
    expect: {
      intents: ["postponing", "interested", "considering"],
      goals: ["book_call", "answer_and_advance"],
      wantsMessage: true,
    },
  },
  {
    slug: "next-week",
    name: "דבר איתי שבוע הבא",
    customerText: "דבר איתי שבוע הבא",
    expect: {
      intents: ["postponing"],
      goals: ["book_call"],
      wantsMessage: true,
      shouldMatchAny: [{ re: "ראשון|שני|שלישי|רביעי|חמישי|\\d{1,2}:\\d{2}|שבוע הבא", why: "לקבע את הדחייה לזמן" }],
    },
  },
  {
    slug: "approval",
    name: "צריך אישור שותף",
    customerText: "נראה טוב אבל אני צריך לבדוק עם השותף שלי",
    expect: {
      intents: ["objecting", "considering", "postponing"],
      goals: ["explore_objection", "book_call", "answer_and_advance"],
      wantsMessage: true,
    },
  },
  {
    slug: "hot",
    name: "ליד חם — בואו נתקדם",
    customerText: "מעולה, בואו נתקדם!",
    expect: {
      intents: ["ready_to_proceed", "interested"],
      goals: ["book_call"],
      wantsMessage: true,
      shouldMatchAny: [{ re: "שיחה|נתקשר|להתקשר|טלפון", why: "רגע חם = הצעת שיחה" }],
    },
  },
  {
    slug: "vague",
    name: "תשובה עמומה",
    customerText: "אוקיי",
    expect: {
      intents: ["considering", "unclear", "interested"],
      goals: ["answer_and_advance", "hold_back"],
      wantsMessage: true,
    },
  },
  {
    slug: "angry",
    name: "לקוח כועס",
    customerText: "די, תפסיקו לשלוח לי הודעות",
    expect: {
      intents: ["not_interested"],
      goals: ["hold_back"],
      wantsMessage: true,
      mustNotMatch: [{ re: "שיחה קצרה|נתקשר|מתי נוח", why: "לא דוחפים שיחה לכועס" }],
    },
  },
  {
    slug: "call-me",
    name: "מבקש שיחה במפורש",
    customerText: "אפשר שמישהו יתקשר אליי?",
    expect: {
      intents: ["interested", "asking_question", "ready_to_proceed"],
      goals: ["book_call"],
      wantsMessage: true,
      shouldMatchAny: [{ re: "\\d{1,2}:\\d{2}|היום|מחר", why: "הצעת זמן קונקרטי" }],
    },
  },
  {
    slug: "silent-3d",
    name: "שתק 3 ימים אחרי הצעה",
    customerText: "",
    ageHours: 72,
    expect: {
      intents: ["gone_quiet"],
      goals: ["revive"],
      wantsMessage: true,
      shouldMatchAny: [{ re: "הצעה|₪|6,?050", why: "עיגון בהצעה הספציפית" }],
    },
  },
];

export interface ScenarioResult {
  slug: string;
  name: string;
  customerText: string;
  pass: boolean;
  failures: string[];
  intent: string | null;
  goal: string | null;
  skills: string[];
  message: string | null;
  wordCount: number | null;
  validationOk: boolean | null;
}

const BASE_CONVO: { dir: "in" | "out"; text: string }[] = [
  { dir: "in", text: "היי, אני צריך שקיות ממותגות לחנות שלי" },
  { dir: "out", text: "שלום! 👋 אני אעזור לך לקבל הצעת מחיר מיידית לשקיות ממותגות." },
  { dir: "in", text: "5,000 יחידות" },
  {
    dir: "out",
    text: "✅ הצעת מחיר:\nשקית H30*D12*W40 ס״מ\nכמות: 5,000 | 2 צבעי הדפסה\n💰 ליחידה: ₪1.21 | סה״כ: ₪6,050.00",
  },
  { dir: "out", text: "מה דעתכם על ההצעה?" },
];

async function seedLead(slug: string, sc: Scenario): Promise<string> {
  const sid = `evaltest:${slug}`;
  await db.execute(sql`DELETE FROM messages WHERE manychat_sub_id = ${sid}`);
  await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id = ${sid}`);
  await db.insert(leads).values({
    manychatSubId: sid,
    name: "לקוח איוואל (בדיקה)",
    waJid: `${slug}.evaltest@c.us`,
    active: false,
    source: "setter_eval",
    pipelineStage: "INTAKE",
    quoteTotal: "6050",
    qState: {
      step: 10,
      product: "p3",
      quantity: "q2",
      shipping: "s2",
      colors: "2",
      doneAt: new Date(Date.now() - 86400_000).toISOString(),
      subFlow: "awaiting_estimate_decision",
    },
  });

  const age = (sc.ageHours ?? 0) * 3600_000;
  const base = Date.now() - age - BASE_CONVO.length * 60_000 - 120_000;
  const rows = BASE_CONVO.map((m, i) => ({
    manychatSubId: sid,
    direction: m.dir,
    text: m.text,
    sender: m.dir === "in" ? "lead" : "bot",
    receivedAt: new Date(base + i * 60_000),
  }));
  if (sc.customerText) {
    rows.push({
      manychatSubId: sid,
      direction: "in",
      text: sc.customerText,
      sender: "lead",
      receivedAt: new Date(Date.now() - age),
    });
  }
  await db.insert(messages).values(rows);
  return sid;
}

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM messages WHERE manychat_sub_id LIKE 'evaltest:%'`);
  await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id LIKE 'evaltest:%'`);
}

export async function runSetterEval(opts?: {
  only?: string[];
}): Promise<{ passed: number; failed: number; results: ScenarioResult[] }> {
  const scenarios = opts?.only?.length
    ? SCENARIOS.filter((s) => opts.only!.includes(s.slug))
    : SCENARIOS;

  const results: ScenarioResult[] = [];
  try {
    for (const sc of scenarios) {
      const sid = await seedLead(sc.slug, sc);
      const run = await runSetter(sid, "eval", { mode: "preview" });

      const failures: string[] = [];
      const intent = run.classification?.intent ?? null;
      const goal = run.strategy?.goal ?? null;
      const text = run.message?.text ?? null;

      if (!run.ok) failures.push(`הרצה נכשלה: ${run.skipped}`);
      if (intent && !sc.expect.intents.includes(intent))
        failures.push(`כוונה: ${intent} (ציפינו: ${sc.expect.intents.join("/")})`);
      if (goal && !sc.expect.goals.includes(goal))
        failures.push(`יעד: ${goal} (ציפינו: ${sc.expect.goals.join("/")})`);
      if (sc.expect.wantsMessage) {
        if (!text) failures.push("לא נוצרה הודעה");
        else if (!run.message?.validation.ok)
          failures.push(`נפסלה בולידציה: ${run.message?.validation.violations.join("; ")}`);
      }
      if (text) {
        for (const rule of sc.expect.mustNotMatch ?? []) {
          if (new RegExp(rule.re).test(text)) failures.push(`אסור: ${rule.why}`);
        }
        const should = sc.expect.shouldMatchAny ?? [];
        if (should.length && !should.some((r) => new RegExp(r.re).test(text))) {
          failures.push(`חסר: ${should.map((r) => r.why).join(" / ")}`);
        }
      }

      results.push({
        slug: sc.slug,
        name: sc.name,
        customerText: sc.customerText || `(שתיקה ${sc.ageHours} שעות)`,
        pass: failures.length === 0,
        failures,
        intent,
        goal,
        skills: run.strategy?.skills ?? [],
        message: text,
        wordCount: run.message?.validation.wordCount ?? null,
        validationOk: run.message?.validation.ok ?? null,
      });
    }
  } finally {
    await cleanup();
  }

  return {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}

/**
 * Live-path check — exercises the ACTUAL decision handler (not runSetter
 * directly) so the setter-live switch itself is what's under test. Outbounds
 * are captured, never sent.
 */
export async function runLivePathCheck(): Promise<{
  action: string;
  answeredBy: "setter" | "scripted" | "none";
  sent: { kind: string; text: string }[];
}> {
  const { runCaptured } = await import("../bot-playground/capture");
  const { handleDecisionInbound } = await import("../autoresponder/decision");
  const sc = SCENARIOS.find((s) => s.slug === "price")!;
  const sid = await seedLead("livepath", sc);
  try {
    const { result, sends } = await runCaptured(() =>
      handleDecisionInbound({ sid, text: sc.customerText, hasMedia: false })
    );
    return {
      action: (result as { action?: string }).action ?? "?",
      answeredBy:
        (result as { action?: string }).action === "setter_replied"
          ? "setter"
          : sends.some((s) => s.kind === "message")
            ? "scripted"
            : "none",
      sent: sends.map((s) => ({ kind: s.kind, text: s.text.slice(0, 200) })),
    };
  } finally {
    await cleanup();
  }
}
