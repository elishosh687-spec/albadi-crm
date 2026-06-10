/**
 * Post-call disposition rules.
 *
 * Each entry maps a GHL Custom Disposition name → an action plan executed by
 * `handleDisposition()` in `./handler.ts`. The disposition name MUST match the
 * exact string Eli typed in GHL Settings → Voice → Custom Dispositions.
 *
 * Keep this file as the SINGLE source of truth for what each button does.
 * Adding a new disposition = add a row here. No code changes elsewhere.
 *
 * Action vocabulary:
 *   - createTask: spawn a GHL Task on the contact, dueIn from now
 *   - incrementFollowupCount: bump leads.follow_up_count + GHL custom field
 *   - moveStage: change opportunity pipeline stage (and DB mirror)
 *   - setLossReason: write loss_reason field (REQUIRED when moveStage = LOST)
 *   - escalateAfterN: optional — if follow_up_count >= N after increment, override
 *     stage/loss_reason (e.g. after 5 "no answer" attempts → auto-LOST).
 */

import type { LocalStage } from "@/integrations/ghl/config";

export type LossReason =
  | "יקר_לו"
  | "לא_ענה"
  | "לא_רלוונטי"
  | "מצא_ספק_אחר"
  | "זמן_אספקה"
  | "כמות";

export interface DispositionRule {
  /** Exact disposition name as typed in GHL. */
  name: string;
  /** Human-readable category for the GHL Task title prefix. */
  label: string;
  /** Increment leads.follow_up_count? */
  incrementFollowupCount?: boolean;
  /** If follow_up_count reaches this value (post-increment), apply escalation. */
  escalateAfterN?: {
    threshold: number;
    moveStage: LocalStage;
    lossReason?: LossReason;
  };
  /** Move opportunity to this stage unconditionally. */
  moveStage?: LocalStage;
  /** Required when moveStage = LOST. */
  lossReason?: LossReason;
  /** Spawn a Task. Omit to skip task creation (e.g. "לא מעוניין"). */
  createTask?: {
    /** Task title — may include `{{name}}` placeholder for contact first name. */
    title: string;
    /** Optional body — supports `{{name}}` and `{{summary}}`. */
    body?: string;
    /** When task is due, relative to "now". One of these MUST be set. */
    dueIn:
      | { hours: number }
      | { days: number }
      | { months: number };
    /** Future-engagement tasks (after LOST) can fire even though stage is terminal. */
    fireAfterStageMove?: boolean;
  };
}

/**
 * Canonical disposition catalogue. Names must match GHL exactly (case-sensitive).
 *
 * If Eli later splits "דחה לתאריך" into "דחה — שבוע / חודש / 3 חודשים"
 * we add 3 new rows below and remove/keep the generic one as desired.
 */
export const DISPOSITION_RULES: DispositionRule[] = [
  // ---------------------------------------------------------------------
  // 1. לא ענה — bump counter, task tomorrow, auto-LOST at 5 attempts
  // ---------------------------------------------------------------------
  {
    name: "לא ענה",
    label: "Retry",
    incrementFollowupCount: true,
    escalateAfterN: {
      threshold: 5,
      moveStage: "LOST",
      lossReason: "לא_ענה",
    },
    createTask: {
      title: "התקשר שוב ל-{{name}}",
      body: "ניסיון נוסף — לא ענה בקריאה האחרונה.\n\nסיכום: {{summary}}",
      dueIn: { days: 1 },
    },
  },

  // ---------------------------------------------------------------------
  // 2. דחה לעוד שעות — short snooze, no counter
  // ---------------------------------------------------------------------
  {
    name: "דחה לעוד שעות",
    label: "Snooze",
    createTask: {
      title: "התקשר שוב ל-{{name}} (דחה לעוד שעות)",
      body: "הלקוח ביקש לחזור באותו יום.\n\nסיכום: {{summary}}",
      dueIn: { hours: 3 },
    },
  },

  // ---------------------------------------------------------------------
  // 3. דחה לתאריך — default 7d snooze + move to FUTURE_FOLLOW_UP
  //    (Eli can later split to שבוע/חודש/3 חודשים if needed.)
  // ---------------------------------------------------------------------
  {
    name: "דחה לתאריך",
    label: "Snooze (week)",
    moveStage: "FUTURE_FOLLOW_UP",
    createTask: {
      title: "תזכורת ל-{{name}} (חזרה אחרי שבוע)",
      body: "הלקוח ביקש לחזור בתאריך עתידי.\n\nסיכום: {{summary}}",
      dueIn: { days: 7 },
    },
  },
  {
    name: "דחה — שבוע",
    label: "Snooze (week)",
    moveStage: "FUTURE_FOLLOW_UP",
    createTask: {
      title: "תזכורת ל-{{name}}",
      body: "ביקש לחזור בעוד שבוע.\n\nסיכום: {{summary}}",
      dueIn: { days: 7 },
    },
  },
  {
    name: "דחה — חודש",
    label: "Snooze (month)",
    moveStage: "FUTURE_FOLLOW_UP",
    createTask: {
      title: "תזכורת ל-{{name}}",
      body: "ביקש לחזור בעוד חודש.\n\nסיכום: {{summary}}",
      dueIn: { days: 30 },
    },
  },
  {
    name: "דחה — 3 חודשים",
    label: "Snooze (3 months)",
    moveStage: "FUTURE_FOLLOW_UP",
    createTask: {
      title: "תזכורת ל-{{name}}",
      body: "ביקש לחזור בעוד 3 חודשים.\n\nסיכום: {{summary}}",
      dueIn: { months: 3 },
    },
  },

  // ---------------------------------------------------------------------
  // 4. אני שולח הצעה — ball-in-my-court, HIGH priority, tomorrow
  // ---------------------------------------------------------------------
  {
    name: "אני שולח הצעה",
    label: "Send Quote",
    createTask: {
      title: "🔥 שלח הצעה ל-{{name}}",
      body: "הבטחת לשלוח הצעה / פריסה / חומר. אם לא נשלח עד מחר 12:00, הליד הולך לאיבוד.\n\nסיכום שיחה: {{summary}}",
      dueIn: { days: 1 },
    },
  },

  // ---------------------------------------------------------------------
  // 5. מחכה ממנו — ball-in-his-court, reminder in 3 days
  // ---------------------------------------------------------------------
  {
    name: "מחכה ממנו",
    label: "Awaiting Customer",
    createTask: {
      title: "תזכורת ל-{{name}} — מחכים ממנו",
      body: "סוכם שהלקוח ישלח לנו מידות / לוגו / הצעת מתחרה / משהו. אם 3 ימים עברו, תזכיר.\n\nסיכום: {{summary}}",
      dueIn: { days: 3 },
    },
  },

  // ---------------------------------------------------------------------
  // 6. נקבעה פגישה — task day-of (placeholder; Eli can adjust due date)
  // ---------------------------------------------------------------------
  {
    name: "נקבעה פגישה",
    label: "Meeting Scheduled",
    moveStage: "DISCAVERY",
    createTask: {
      title: "📅 פגישה עם {{name}}",
      body: "סוכם על פגישה / שיחה. עדכן ידנית את ה-due date לזמן הפגישה.\n\nסיכום: {{summary}}",
      dueIn: { days: 1 },
    },
  },

  // ---------------------------------------------------------------------
  // 7. סגרנו עסקה — WON
  // ---------------------------------------------------------------------
  {
    name: "סגרנו עסקה",
    label: "Closed Won",
    moveStage: "WON",
    createTask: {
      title: "✅ עוקב אחרי תשלום / שילוח ל-{{name}}",
      body: "עסקה נסגרה. וודא שהתשלום הראשון התקבל ושהשילוח בתהליך.\n\nסיכום: {{summary}}",
      dueIn: { days: 3 },
    },
  },

  // ---------------------------------------------------------------------
  // 8. לא מעוניין — LOST, no task, end of story
  // ---------------------------------------------------------------------
  {
    name: "לא מעוניין",
    label: "Not Interested",
    moveStage: "LOST",
    lossReason: "לא_רלוונטי",
    // No task — done.
  },

  // ---------------------------------------------------------------------
  // 9. יקר / מצא ספק — LOST + 90-day re-engage task (second chance)
  // ---------------------------------------------------------------------
  {
    name: "יקר / מצא ספק",
    label: "Price / Competitor",
    moveStage: "LOST",
    lossReason: "יקר_לו",
    createTask: {
      title: "🔁 בדוק אם {{name}} עדיין עם המתחרה",
      body: "הלקוח אמר 'יקר' או 'מצא במחיר זול יותר'. תזכורת אחרי 90 יום לבדוק אם החזיק את המחיר.\n\nסיכום: {{summary}}",
      dueIn: { months: 3 },
      fireAfterStageMove: true,
    },
  },
];

/**
 * Lookup a disposition rule by exact name. Returns null when GHL sends an
 * unknown disposition (e.g. Eli added a button but forgot to update this file).
 * The webhook endpoint logs + 200s on null so GHL doesn't retry forever.
 */
export function findRule(name: string): DispositionRule | null {
  const trimmed = name.trim();
  return DISPOSITION_RULES.find((r) => r.name === trimmed) ?? null;
}
