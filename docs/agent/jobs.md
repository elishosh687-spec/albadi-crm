# Scheduled jobs & watchdog

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Scheduled jobs ring a phone — heartbeats + watchdog (built 2026-09-10)

**Why:** the estimator refit cron was dead from 2026-06-24 to 2026-09-09 —
`middleware.ts` 307'd Vercel's daily GET to `/api/factory/refit-estimator`
(only `refresh`/`test-dm` were on the bearer allow-list) — and nothing said a
word. Eli: *"לוגים רציניים בלי התראה זה לא שווה, ורק בוואטסאפ"*.

- Every scheduled route is wrapped with **`withJob(job, feature, handler)`**
  ([lib/observability/jobs.ts](lib/observability/jobs.ts)) instead of bare
  `withRequestLog`: 2xx = success heartbeat, 5xx/throw = failure, 401/307 =
  not a run. Names + schedules live in `JOBS`; state in `app_config`
  `jobs.status` (per-job `jsonb_set`).
- **`/api/cron/job-watchdog`** runs every 30 min from
  `.github/workflows/job-watchdog.yml` (`CALL_TRIGGER_SECRET`) and **WhatsApps
  Eli** (`sendEliDM`) once per incident when a job is late (3 missed ticks, or
  6h past a daily slot) or failed, and once on recovery. `?dry=1` previews.
  A new cron MUST be added to `JOBS` and wrapped with `withJob`, or it is
  invisible again.
- **Any bearer-authed job under `/api/factory/*` must ALSO be added to the
  allow-list in `middleware.ts`** — the route's own auth is never reached
  otherwise. `CRON_SECRET` and `CALL_TRIGGER_SECRET` are readable via
  `vercel env pull`; `BOT_SECRET` is not, so trigger crons by hand with those.
- **⚠️ The heartbeat must be AWAITED, and GitHub is no longer the scheduler
  (2026-09-13).** Two faults, both silent, both found from one WhatsApp flood
  — 11 🚨→✅ cycles in two days:
  1. `withJob` fired `void recordJobRun(...)`. The response returned, Vercel
     froze the lambda mid-write, and the row never reached Neon. Reproduced on
     prod twice: `/api/factory/refresh` answered
     `200 {"ok":true,"scanned":3}` while `jobs.status` sat a full day back, so
     **the watchdog WhatsApped Eli about jobs that were running perfectly**.
     `callback-requests`, the fastest route, was two days stale. It is
     `await`ed now — `recordJobRun` swallows its own errors, so awaiting it
     cannot break the job it measures. Regression test in
     [jobs.test.ts](lib/observability/jobs.test.ts) ("awaits the heartbeat");
     the old `settle()` cushion is gone from that file on purpose, so every
     assertion there now depends on the await.
  2. **The recovery never cleared its own flag**, so the ✅ re-sent forever.
     `writeJob(job, { alertedAt: undefined })` serialises to `"{}"` and
     `jsonb || '{}'` is a no-op — a merge cannot DELETE. The flag survived
     every recovery, so each later tick saw it still set and re-announced the
     same eight jobs; that is why his thread held far more ✅ than 🚨.
     `writeJob` takes a `clear` list now and removes the keys with jsonb `-`.
     ⚠️ **Single-quote those key names** — `"x"` is an IDENTIFIER in Postgres,
     so the first cut died with `column "lastError" does not exist`, which
     `recordJobRun` would have swallowed into a silent heartbeat outage.
     The same `undefined` hole was clearing `lastError` on success: also fixed.
     **Verify jsonb surgery against the real DB, not only against a mock** —
     the unit test was green while the statement could not run at all.
  3. **GitHub Actions stopped honouring the crons on 2026-08-27** — repo-wide
     scheduled runs fell from 123–153/day to 11–13, recovering only to ~50.
     `process-recordings` is a `*/5` job: it ran **7 times a day**.
     `factory-refresh` and `followups`, both `*/15`: 7 a day each. No workflow
     changed that week (checked) — it is GitHub throttling, and each run that
     does fire still succeeds, which is why nothing looked broken. The crons
     **should move off GitHub — Eli chose cron-job.org, every 5 minutes, and
     as of 13/09 it is NOT SET UP YET.** Until he does it, every cron still
     depends on GitHub and still runs ~7 times a day. ⚠️ An earlier draft of
     this paragraph said the move was done; a background agent read it, believed
     it, and told Eli in WhatsApp that his jobs were "running through
     cron-job.org and unaffected" — which was false. **Write a plan as a plan.**
     The workflows stay afterwards as a free safety net (every endpoint is
     guarded against double-firing by a run-lock or a dedupe key). One value covers six jobs — `BOT_SECRET` —
     but `/api/factory/refresh` checks **`CRON_SECRET` only**, so that one is
     the odd row. cron-job.org aborts at 30s while `process-recordings` runs
     to ~95s: it shows there as failed while it is fine. **The watchdog is the
     truth, not their dashboard.**
  A late job and a failed job are different incidents and no longer share
  wording: `❌ נכשל` vs `⏳ לא רץ` + "הריצה האחרונה הצליחה". Reading "לא הצליח"
  sent us hunting an exception that never existed.
- **Refit gate (2026-09-10):** with the Aug–Sep quotes the LOO median was
  7.3% vs the 6% gate — the rows pushing it over were narrow-tall (wine) bags
  and 1,000-qty runs, which the estimator now REFUSES (`isNarrowTall`,
  `MIN_QTY` in [lib/factory/estimator.ts](lib/factory/estimator.ts)) and the
  LOO mirrors. First publish since June landed the same day: median 4.5% on
  56 quote-log + 33 DB points. The estimator's shipping buffers are settings
  now (`estimatorShippingBufferPct` 15 / `estimatorShippingBufferLamPct` 10,
  in the factory config); the old hardcoded 30% for laminated is gone. Simon's
  factory-by-construction table (heat-press 3D → CHEN/MANDY; sewing and 2D →
  WEIWEI/CHEN) checked against 44 quote-log rows: zero contradictions.
  Since 2026-09-10 the estimator PICKS BY IT (`construction` on
  `EstimateSpec`, `allowedFactoriesFor`): heat-press 3D → Mandy, heat-press
  2D / any sewn bag → 亚森; CHEN has no price model, so a bag only CHEN would
  make (or a laminated sewn bag) is refused → factory. "סוג ייצור" selector
  on both estimate screens; the bot defaults to heat-press.
