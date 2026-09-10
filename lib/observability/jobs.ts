/**
 * Job heartbeats + the watchdog that turns a SILENT failure into a WhatsApp.
 *
 * Every scheduled job (Vercel cron or GitHub-Action cron) records each run via
 * `recordJobRun` — normally through `withRequestLog(feature, handler, { job })`,
 * which does it from the route wrapper. `runWatchdog()` (hit every 30 min by
 * .github/workflows/job-watchdog.yml) then asks one question per job: "did it
 * succeed recently enough?" and DMs Eli on WhatsApp when the answer flips to
 * no — once per incident, plus one message when it recovers.
 *
 * Why this exists: the estimator refit cron was dead from 2026-06-24 to
 * 2026-09-09 (middleware 307'd the cron's GET) and nothing said a word — the
 * refit even sends a "here's what I did" DM, so silence looked like success.
 * A log line nobody reads is not an alert. Eli: "לוגים רציניים בלי התראה זה לא
 * שווה, ורק בוואטסאפ".
 *
 * State: one app_config row `jobs.status` = { [job]: JobState, _installedAt }.
 * Writes are per-job `jsonb_set`, so concurrent jobs never clobber each other.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { logger } from "./log";

const log = logger("cron");
const KEY = "jobs.status";

export interface JobDef {
  /** Hebrew name as it should read in the WhatsApp. */
  label: string;
  /** Nominal schedule. */
  everyMin: number;
  /** Who fires it — only for the message text. */
  via: "vercel" | "github";
}

export const JOBS = {
  "refit-estimator": { label: "כיול המחשבון המשוער", everyMin: 24 * 60, via: "vercel" },
  "refresh-fx": { label: "עדכון שערי מטבע", everyMin: 24 * 60, via: "vercel" },
  "analyze-active-leads": { label: "ניתוח לידים פעילים", everyMin: 24 * 60, via: "vercel" },
  "enrich-meta-attribution": { label: "שיוך לידים למודעות (Meta)", everyMin: 24 * 60, via: "vercel" },
  followups: { label: "פולואפים של הבוט", everyMin: 15, via: "github" },
  "process-recordings": { label: "עיבוד הקלטות שיחה", everyMin: 5, via: "github" },
  "factory-refresh": { label: "רענון הצעות מהמפעל (Feishu)", everyMin: 15, via: "github" },
  "greenapi-health": { label: "בדיקת חיבור וואטסאפ", everyMin: 30, via: "github" },
  "resume-sweep": { label: "החזרת הבוט מהשתקה", everyMin: 60, via: "github" },
  "callback-requests": { label: "בקשות זמן לשיחה", everyMin: 30, via: "github" },
  "elevenlabs-sync": { label: "סנכרון שיחות הסוכן הקולי", everyMin: 5, via: "github" },
  "job-watchdog": { label: "השומר עצמו", everyMin: 30, via: "github" },
} as const satisfies Record<string, JobDef>;
export type JobName = keyof typeof JOBS;

export interface JobState {
  lastRunAt?: string;
  lastOkAt?: string;
  lastStatus?: "ok" | "failed";
  lastError?: string;
  lastDurationMs?: number;
  /** Set while an incident is open; cleared by the recovery message. */
  alertedAt?: string;
  alertKind?: "late" | "failed";
}
type StatusDoc = Record<string, JobState> & { _installedAt?: string };

/** A job counts as LATE after this many minutes without a success. Frequent
 *  jobs get three missed ticks; daily jobs get a 6-hour grace past their slot. */
export function lateAfterMin(everyMin: number): number {
  return everyMin <= 60 ? everyMin * 3 + 5 : everyMin + 6 * 60;
}

async function readStatus(): Promise<StatusDoc> {
  const r = (await db.execute(sql`SELECT value FROM app_config WHERE key = ${KEY}`)).rows[0] as
    | { value: StatusDoc }
    | undefined;
  return r?.value ?? {};
}

async function writeJob(job: string, patch: Partial<JobState>): Promise<void> {
  const json = JSON.stringify(patch);
  // Merge into the job's own sub-object only (|| on the nested object), so two
  // jobs finishing in the same second can't overwrite each other's fields.
  await db.execute(sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (${KEY}, jsonb_build_object(${job}::text, ${json}::jsonb, '_installedAt', to_jsonb(now()::text)), now())
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_set(
        COALESCE(app_config.value, '{}'::jsonb),
        ARRAY[${job}::text],
        COALESCE(app_config.value -> ${job}::text, '{}'::jsonb) || ${json}::jsonb,
        true
      ),
      updated_at = now()`);
}

/** Record one run. Never throws — a heartbeat must not break the job. */
export async function recordJobRun(
  job: JobName,
  r: { ok: boolean; status?: number; error?: string; durationMs?: number },
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await writeJob(job, {
      lastRunAt: now,
      lastStatus: r.ok ? "ok" : "failed",
      lastDurationMs: r.durationMs,
      ...(r.ok ? { lastOkAt: now, lastError: undefined } : { lastError: (r.error ?? `HTTP ${r.status ?? "?"}`).slice(0, 300) }),
    });
  } catch (e) {
    log.warn("job.heartbeat_write_failed", { job, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface JobCheck {
  job: JobName;
  label: string;
  state: JobState;
  health: "ok" | "late" | "failed" | "never";
  minutesSinceOk: number | null;
  lateAfterMin: number;
}

export async function checkJobs(now = new Date()): Promise<{ checks: JobCheck[]; installedAt: string | null }> {
  const doc = await readStatus();
  const installedAt = doc._installedAt ?? null;
  const baseline = installedAt ? new Date(installedAt).getTime() : now.getTime();
  const checks: JobCheck[] = [];
  for (const [name, def] of Object.entries(JOBS) as [JobName, JobDef][]) {
    const st = doc[name] ?? {};
    const okAt = st.lastOkAt ? new Date(st.lastOkAt).getTime() : null;
    const since = okAt != null ? (now.getTime() - okAt) / 60000 : null;
    const limit = lateAfterMin(def.everyMin);
    let health: JobCheck["health"] = "ok";
    if (st.lastStatus === "failed") health = "failed";
    else if (okAt == null) {
      // Never succeeded: late only once the watchdog has been installed long
      // enough for the job to have had its chance (else day one is 12 alerts).
      health = (now.getTime() - baseline) / 60000 > limit ? "never" : "ok";
    } else if (since! > limit) health = "late";
    checks.push({ job: name, label: def.label, state: st, health, minutesSinceOk: since, lateAfterMin: limit });
  }
  return { checks, installedAt };
}

function fmtAge(min: number | null): string {
  if (min == null) return "אף פעם";
  if (min < 90) return `לפני ${Math.round(min)} דק׳`;
  if (min < 48 * 60) return `לפני ${(min / 60).toFixed(1)} שעות`;
  return `לפני ${Math.round(min / 60 / 24)} ימים`;
}

export interface WatchdogResult {
  ok: true;
  checked: number;
  unhealthy: { job: JobName; health: JobCheck["health"]; lastOk: string | null }[];
  alerted: JobName[];
  recovered: JobName[];
  dry: boolean;
}

/** The 30-minute tick. `dry` computes and reports but sends nothing and stores nothing. */
export async function runWatchdog(opts?: { dry?: boolean }): Promise<WatchdogResult> {
  const dry = opts?.dry ?? false;
  const { checks } = await checkJobs();
  const now = Date.now();
  const alerted: JobName[] = [];
  const recovered: JobName[] = [];
  const alertLines: string[] = [];
  const recoverLines: string[] = [];

  for (const c of checks) {
    const bad = c.health !== "ok";
    const alertedAt = c.state.alertedAt ? new Date(c.state.alertedAt).getTime() : null;
    if (bad) {
      // One message per incident; nag again after 24h if still down.
      const stale = alertedAt == null || now - alertedAt > 24 * 60 * 60 * 1000;
      if (!stale) continue;
      const why =
        c.health === "failed"
          ? `נכשל: ${c.state.lastError ?? "?"}`
          : c.health === "never"
            ? "לא רץ אף פעם"
            : `לא הצליח ${fmtAge(c.minutesSinceOk)} (אמור כל ${JOBS[c.job].everyMin >= 60 ? `${JOBS[c.job].everyMin / 60} שעות` : `${JOBS[c.job].everyMin} דק׳`})`;
      alertLines.push(`• ${c.label} — ${why}`);
      alerted.push(c.job);
      if (!dry) await writeJob(c.job, { alertedAt: new Date().toISOString(), alertKind: c.health === "failed" ? "failed" : "late" });
    } else if (alertedAt != null) {
      recoverLines.push(`• ${c.label} — חזר לעבוד (הצליח ${fmtAge(c.minutesSinceOk)})`);
      recovered.push(c.job);
      if (!dry) await writeJob(c.job, { alertedAt: undefined, alertKind: undefined });
    }
  }

  if (!dry && (alertLines.length || recoverLines.length)) {
    const { sendEliDM } = await import("@/lib/notify/eli");
    if (alertLines.length) {
      const r = await sendEliDM(`🚨 *משימות אוטומטיות שלא רצות*\n${alertLines.join("\n")}\n\nפרטים: Axiom → albadi_crm, feature=cron`);
      log.warn("watchdog.alerted", { jobs: alerted, dm: r });
    }
    if (recoverLines.length) {
      const r = await sendEliDM(`✅ *חזרו לעבוד*\n${recoverLines.join("\n")}`);
      log.info("watchdog.recovered", { jobs: recovered, dm: r });
    }
  }

  return {
    ok: true,
    checked: checks.length,
    unhealthy: checks.filter((c) => c.health !== "ok").map((c) => ({ job: c.job, health: c.health, lastOk: c.state.lastOkAt ?? null })),
    alerted,
    recovered,
    dry,
  };
}
