# Tests

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Tests (built 2026-09-10) — vitest, no DB, alerts on WhatsApp

**Run:** `npm test` (unit), `npm run test:watch`, `npm run typecheck`. Config is
[vitest.config.mts](vitest.config.mts) (`.mts` because `package.json` has no
`"type"`). Tests sit **next to their module** (`lib/factory/pricing.test.ts`);
architecture tests live in `tests/unit/architecture/`; shared fixtures in
`tests/fixtures/`. `studio/`, `legacy/`, `scripts/`, `bot design/` are excluded.

**The one rule that keeps the suite honest: an incident with a "symptom to watch"
in this file gets a regression test.** The suite was seeded from the incidents
above — ₪0 shipping on `s2`, three totals for one quote, the Feishu column
shift, "היום ב-17:00" at 19:20, opt-out un-paused from GHL, the refit cron
dead behind the middleware allow-list. When you fix the next one, add the test
in the same commit; don't write a paragraph here instead of a test.

**No database in unit tests, by construction.** `tests/setup.unit.ts` replaces
`@/lib/db` with a Proxy that throws `"DB touched in a unit test"` on any access.
That is what lets `estimator.ts`, the setter validator, `website-origin`,
`lead-gaps` load without `DATABASE_URL`, and it means a unit test that reaches
the DB fails in one line instead of hanging on HTTP. The pure defaults live in
[lib/factory/config-defaults.ts](lib/factory/config-defaults.ts) and
[lib/factory/estimator-defaults.ts](lib/factory/estimator-defaults.ts) so
fixtures never import `config.ts` (which drags the DB in). Never import
`lib/factory/calculator/index.ts` from a test for the same reason — use
`calculator/constants.ts`.

**What is tested, in order of value:** the money maths (`pricing`, `engine`,
`payment-terms`, `customer-total`, `shipping-split`, `combined`, `molds`,
`message`, `estimator`); the parsers and validators (Feishu row parser, GreenAPI
text extractor, follow-up cadence, bot-pause, call slots, `validateMessage`,
stages, FB-form columns, lead-gap classifier, website origin, follow-up drop);
and three architecture tests that turn CLAUDE.md rules into assertions — no
`"use client"` file reaches `lib/db`/`manychat/config` transitively, every
`app/api/**/route.ts` is wrapped, and every `/api/factory/*` job is in the
middleware allow-list. LLM output is NOT unit-tested — that is what
`setter-eval` (manual, spends money) is for.

**CI:** [.github/workflows/test.yml](.github/workflows/test.yml) runs `tsc` +
`npm test` on every push to `main` and every PR. **It informs, it does not
gate** — Vercel deploys the push regardless (Eli's call). A failure on `main`
POSTs `/api/admin/ci-alert` with `CALL_TRIGGER_SECRET`, which `sendEliDM`s the
short sha + commit line + run URL. `?dry=1` returns the text without sending.

**Phase B — route tests on a real database (built 2026-09-10).**
`npm run test:integration` runs `tests/integration/` (project `integration`)
against `DATABASE_URL`, which must be a **throwaway Neon branch**:
`tests/setup.integration.ts` refuses the production endpoint
(`ep-misty-bread-akwno7u7`) outright. Locally:

```bash
N=~/.local/node/bin/neonctl; P="fragrant-morning-71359670"
$N branches create --project-id $P --org-id org-frosty-star-50411125 --name ci-local --parent main
DATABASE_URL="$($N connection-string --project-id $P --org-id org-frosty-star-50411125 --branch ci-local)" npm run test:integration
$N branches delete ci-local --project-id $P --org-id org-frosty-star-50411125
```

Five files, ~60 tests: the GreenAPI webhook (401, idempotency claim in
`bridge_events`, **a team member never becomes a lead**, website prefill →
`lead_source` + `source_touches`, quotedMessage keeps its text), the job
heartbeat + `checkJobs` on the real `app_config` row, the follow-ups run-lock
(held / expired / two concurrent ticks), `closeDealGroup` freezing the combined
offer + `removeDeal` + `setDealClosed`, and a **sweep that calls every route
declaring `authorized()`/`authed()` with no bearer and expects 401** — it found
`POST /api/factory/refit-estimator` on day one, which is legitimately gated by
the middleware cookie and is now an explicit, verified exemption in the test.
Only edges that leave the system are stubbed (GHL, supervisor, questionnaire,
LLM composer, Meta, Eli's DM); `BRIDGE_DRY_RUN=1` is forced and no GreenAPI /
GHL / OpenAI credential is set, so a path that slips a stub fails loudly rather
than messaging anyone. The branch is a full copy of production — tests seed
their own `test:ci-*` rows and never print customer data.

**Who guards every door — `tests/integration/route-gates.test.ts` (2026-09-11).**
Every `app/api/**/route.ts` must fall into exactly ONE bucket: `bearer`
(declares `authorized()`/`authed()`, exercised by the sweep), `own-gate`
(widgetAuthed / salesAuthed / verifyWidgetToken / an import secret / a webhook
signature / inline BOT_SECRET — exercised: every method, no credential → 401),
`middleware` (no check of its own, `/api/factory/*` behind the cookie — asserted
against `middleware.ts`), `public` (an explicit reason each: the login, the
customer 3D configurator, the media proxies GHL fetches, OAuth), or
`unprotected` (a finding, `it.fails` until fixed). A new route that matches
nothing fails the coverage test. Two findings on day one, both real and both
**fixed the same day** (now plain regression tests): `POST /api/ai/chat` had no
auth at all (fed lead names/phones/notes to an LLM and streamed the answer; only
caller is the dead v3 dashboard) — it takes the dashboard cookie or a Bearer
BOT_SECRET now; and `/api/integrations/outbound` (the GHL conversation-provider
hook — a POST makes the CRM WhatsApp a lead) failed OPEN while
`GHL_OUTBOUND_SECRET` was unset, which it still was a month after that was
declared temporary. **It fails CLOSED now:** no secret → 401
`secret_not_configured` + an error log line. The secret is in Vercel and on the
provider's Delivery URL in the GHL Marketplace app (`?secret=…`); rotate both
together, GHL first, or Eli's Inbox replies stop — loudly, which is the point.
**Where that URL lives:** there is NO API for it (`/conversations/providers`
answers 400 in API version 2021-07-28). marketplace.gohighlevel.com → My apps →
"Albadi WhatsApp" (Live) → Modules → Conversation Providers → ⋯ → View details.
The form is editable even on the LIVE version; Save applies immediately. A GHL
reply that hits a wrong URL shows as `ghl_app.OutboundMessage` with
`status:"failed"` in `bridge_events` — that is the tell (2026-09-11).
Two test-env facts worth knowing: `lib/messaging/index.ts` picks its backend with
a CommonJS `require`, which vitest cannot resolve, so the integration project
aliases `@/lib/messaging` to `tests/shims/messaging.ts`; and
`lib/manychat/config.ts` still throws at import without `MANYCHAT_TOKEN`, which
`app/actions/v2.ts` drags into several widget routes — the variable is set in
prod, so it is set in the test env too. Removing it from Vercel would break
those routes at import.

**CI:** the `integration` job in `test.yml` creates `ci-<run_id>` from `main`,
runs, and deletes it in `if: always()` (plus a sweep of `ci-*` branches older
than a day — the free tier caps at 10). It needs **`NEON_API_KEY`** as a repo
secret (Neon console → Account settings → API keys) and skips itself with a
notice until that exists. Not run on PRs (the branch is a prod copy).

**Phase C — Playwright — still planned, not built:** 5 flows on the widget.
Plan file: `~/.claude/plans/immutable-sprouting-walrus.md`.

**Two `it.fails` are findings, not flakes** (2026-09-10): four
`console.error` calls survive in the dead `/dashboard/v3` tree, and the hour
guard's 4-character form (`9:00`) is unreachable while `HOUR_POOL` starts at
10. When one is fixed the test "fails" by passing — drop the `.fails` then.
(A third — the two monthly reminder crons missing from `JOBS` — was found by
the allow-list test and fixed the same day.)

**Known gaps:** `npm run lint` is dead (`next lint` was removed in Next 16 and
no eslint config exists); `scripts/` is neither type-checked nor tested.
