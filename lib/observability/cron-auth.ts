/**
 * One bearer rule for every scheduled job.
 *
 * The jobs grew up accepting different secrets (followups: BOT/CRON,
 * factory refresh: CRON only, WhatsApp health: BOT/CALL_TRIGGER, recordings:
 * BOT/CALL_TRIGGER …). Moving the schedule to cron-job.org (2026-09-18) meant
 * cloning one working job per task — and a clone carrying the "wrong" secret
 * would 401, which withJob does not record, so the task would stay silently
 * unscheduled. Every job now accepts any of the three internal secrets; they
 * are the same trust level (server-to-server, never in a browser).
 */
export const CRON_SECRET_ENV = ["BOT_SECRET", "CALL_TRIGGER_SECRET", "CRON_SECRET"] as const;

export function cronBearerOk(header: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const h = (header ?? "").trim();
  if (!h) return false;
  return CRON_SECRET_ENV.some((name) => {
    const s = (env[name] ?? "").trim();
    return s.length > 0 && h === `Bearer ${s}`;
  });
}
