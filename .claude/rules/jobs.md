---
paths:
  - "lib/observability/jobs.ts"
  - "app/api/cron/**"
  - ".github/workflows/**"
  - "middleware.ts"
---

# Scheduled jobs & watchdog
- Every scheduled route uses `withJob(job, feature, handler)` (`lib/observability/jobs.ts`), not bare `withRequestLog`: 2xx = success, 5xx/throw = failure, 401/307 = not a run. A new cron MUST be added to `JOBS` and wrapped, or it is invisible.
- State lives in `app_config` `jobs.status`; `/api/cron/job-watchdog` (every 30 min, `.github/workflows/job-watchdog.yml`) WhatsApps Eli via `sendEliDM` on late/failed and on recovery; `?dry=1` previews.
- Any bearer-authed job under `/api/factory/*` must also be on the `middleware.ts` allow-list, or middleware 307s it and the job silently never runs.
- The heartbeat must be AWAITED — a `void recordJobRun(...)` gets frozen mid-write and the watchdog false-alarms on healthy jobs.
- A jsonb merge cannot delete: `writeJob` takes a `clear` list removed with jsonb `-`; single-quote key names (`"x"` is an identifier). Passing `undefined` does nothing (un-cleared flag = ✅ re-sent forever).
- `recordJobRun` swallows its own errors — verify jsonb SQL against the real DB, not only a mock.
- GitHub Actions throttles schedules (a `*/5` job ran ~7×/day), so since 18/09 all seven jobs run from cron-job.org (clones sharing one Authorization header; the GitHub workflows stay as a safety net). The watchdog is the truth, not their dashboard.
- Every job accepts any of `BOT_SECRET`/`CALL_TRIGGER_SECRET`/`CRON_SECRET` (`lib/observability/cron-auth.ts`); trigger by hand with `CRON_SECRET`/`CALL_TRIGGER_SECRET` (`BOT_SECRET` isn't pullable). `/api/factory/refresh` job = GET only.
- Late (`⏳ לא רץ`) and failed (`❌ נכשל`) alerts are distinct incidents; keep wording separate.

Full detail: `docs/agent/jobs.md` — read it before non-trivial changes here.
