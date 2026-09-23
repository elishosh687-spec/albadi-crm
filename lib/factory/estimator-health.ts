/**
 * "Is the calculator-accuracy loop actually working?" — the settings screen
 * "דיוק המחשבון" (Eli 2026-09-22). Pure: the API route gathers the live state
 * (job heartbeat, published coefficients, the refit's last outcome) and this
 * turns it into checks a human can read.
 *
 * Why it exists: the refit cron was dead for 11 weeks (2026-06-24 → 09-09) and
 * nothing said a word; and "the calculator learns from every factory quote" was
 * believed while only LAMINATED quotes ever changed a coefficient.
 */

export type HealthStatus = "ok" | "warn" | "fail";

export interface EstimatorHealthInput {
  /** refit-estimator heartbeat, from checkJobs(). */
  job: { health: "ok" | "late" | "failed" | "never"; minutesSinceOk: number | null; lastError?: string };
  /** Published coefficients (app_config factory_estimators). */
  coeffs: {
    fittedAt?: string;
    accuracy?: { medianPct: number; maxPct: number; n: number } | null;
    carton?: { fittedAt?: string; accuracy?: { medianPct: number; maxPct: number; n: number } | null } | null;
  };
  /** The refit's last outcome (app_config estimator.last_refit_at .result); absent before the first run that stores it. */
  lastRefit?: {
    ranAt?: string;
    result?: {
      published: boolean; reason: string;
      catalogPoints: number; quoteLogPoints: number; dbPoints: number;
      cartonMedianPct: number | null; cartonPublished: boolean;
      quotesLearned: number; quotesGradingOnly: number; quotesUnmodelled: number;
    };
  } | null;
}

export interface HealthCheck { id: string; label: string; status: HealthStatus; detail: string }
export interface EstimatorHealth { status: HealthStatus; checks: HealthCheck[] }

/** Publish gate — mirrors GATE_MEDIAN in refit-estimator.ts. */
export const PRICE_GATE_PCT = 6;
/** Carton gate — mirrors the ≤10% gate in refit-estimator.ts. */
export const CARTON_GATE_PCT = 10;
/** A daily job plus a slack day: older than this and the numbers are stale. */
const STALE_DAYS = 2;

const DAY = 86_400_000;
const daysBetween = (a: string, b: Date) => Math.floor((b.getTime() - new Date(a).getTime()) / DAY);
const heDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${+d}.${+m}.${y.slice(2)}`; };
const age = (min: number) => (min < 90 ? `לפני ${Math.round(min)} דק׳` : min < 48 * 60 ? `לפני ${Math.round(min / 60)} שעות` : `לפני ${Math.round(min / 1440)} ימים`);

/** Translate the refit's English `reason` for Eli. */
function reasonHe(reason: string): string {
  const gate = reason.match(/new median ([\d.]+)% > ([\d.]+)% gate/);
  if (gate) return `הסטייה החדשה ${gate[1]}% מעל הסף ${gate[2]}% — נשארו הנוסחאות הקודמות`;
  const worse = reason.match(/new median ([\d.]+)% materially worse than current ([\d.]+)%/);
  if (worse) return `הכיול החדש (${worse[1]}%) גרוע מהנוכחי (${worse[2]}%) — נשארו הנוסחאות הקודמות`;
  return reason;
}

export function assessEstimatorHealth(input: EstimatorHealthInput, now = new Date()): EstimatorHealth {
  const checks: HealthCheck[] = [];
  const { job, coeffs } = input;
  const r = input.lastRefit?.result;

  // 1. Does the daily job run at all?
  checks.push(
    job.health === "ok" && job.minutesSinceOk != null
      ? { id: "runs", label: "הכיול היומי רץ", status: "ok", detail: `ריצה אחרונה תקינה ${age(job.minutesSinceOk)}` }
      : job.health === "failed"
        ? { id: "runs", label: "הכיול היומי רץ", status: "fail", detail: `הריצה האחרונה נכשלה: ${job.lastError ?? "שגיאה לא ידועה"}` }
        : { id: "runs", label: "הכיול היומי רץ", status: "fail", detail: job.minutesSinceOk == null ? "הכיול עוד לא רץ אף פעם" : `לא רץ ${age(job.minutesSinceOk)}` },
  );

  // 2. Did it publish new formulas, or keep the old ones?
  const fittedAt = coeffs.fittedAt;
  const fitAge = fittedAt ? daysBetween(fittedAt, now) : Infinity;
  if (!fittedAt) {
    checks.push({ id: "published", label: "הנוסחאות מתעדכנות", status: "warn", detail: "אין תאריך כיול — המחשבון רץ על ברירת המחדל" });
  } else if (fitAge > STALE_DAYS) {
    checks.push({ id: "published", label: "הנוסחאות מתעדכנות", status: "warn", detail: `עודכנו לאחרונה ב‑${heDate(fittedAt)} (לפני ${fitAge} ימים)${r && !r.published ? ` — ${reasonHe(r.reason)}` : ""}` });
  } else if (r && !r.published) {
    checks.push({ id: "published", label: "הנוסחאות מתעדכנות", status: "warn", detail: reasonHe(r.reason) });
  } else {
    checks.push({ id: "published", label: "הנוסחאות מתעדכנות", status: "ok", detail: `עודכנו ב‑${heDate(fittedAt)}` });
  }

  // 3. How close is the price to real factory quotes?
  const acc = coeffs.accuracy;
  checks.push(
    !acc
      ? { id: "accuracy", label: "דיוק המחיר", status: "warn", detail: "אין עדיין מדידת דיוק" }
      : {
          id: "accuracy", label: "דיוק המחיר",
          status: acc.medianPct <= PRICE_GATE_PCT ? "ok" : "warn",
          detail: `סטייה חציונית ${acc.medianPct.toFixed(1)}% מול ${acc.n} הצעות מפעל אמיתיות (סף ${PRICE_GATE_PCT}%) · הכי רחוקה ${Math.round(acc.maxPct)}%`,
        },
  );

  // 4. Packing (CBM) model — has its own gate and can freeze on its own.
  const carton = coeffs.carton;
  if (carton?.fittedAt) {
    const frozenDays = daysBetween(carton.fittedAt, fittedAt ? new Date(fittedAt) : now);
    const cm = r?.cartonMedianPct ?? carton.accuracy?.medianPct;
    const frozen = frozenDays > STALE_DAYS || (r != null && !r.cartonPublished);
    checks.push({
      id: "carton", label: "מודל האריזה (נפח שילוח)",
      status: frozen ? "warn" : "ok",
      detail: frozen
        ? `קפוא מאז ${heDate(carton.fittedAt)}${cm != null ? ` — הסטייה ${cm.toFixed(1)}% מעל הסף ${CARTON_GATE_PCT}%, לכן לא מתעדכן` : ""}`
        : `עודכן ב‑${heDate(carton.fittedAt)}${cm != null ? ` · סטייה ${cm.toFixed(1)}%` : ""}`,
    });
  }

  // 5. What do the factory quotes actually teach?
  if (!r) {
    checks.push({ id: "learning", label: "מה נלמד מהצעות המפעל", status: "warn", detail: "יוצג אחרי הכיול הבא (04:00)" });
  } else {
    checks.push({
      id: "learning", label: "מה נלמד מהצעות המפעל",
      status: r.quotesGradingOnly > 0 || r.quotesUnmodelled > 0 ? "warn" : "ok",
      detail:
        `${r.quotesLearned} הצעות עם למינציה משנות את הנוסחה · ` +
        `${r.quotesGradingOnly} הצעות רגילות רק בודקות אותה (המחיר הרגיל נלמד מ‑${r.catalogPoints} שורות קטלוג בלבד)` +
        (r.quotesUnmodelled ? ` · ${r.quotesUnmodelled} ממפעל בלי מודל (למשל 鼎驰) — לא נכנסות בכלל` : ""),
    });
  }

  const status: HealthStatus = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { status, checks };
}
