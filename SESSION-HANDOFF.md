# Session handoff

## Pending project — Meta ad recommendations

- Eli approved a design for a recommendation-only decision engine inside the
  canonical GHL Hub `מודעות` widget.
- Phases 1–3 are deployed to production (see below). No Meta object was
  changed; the only Meta change was the system user's ad-account access.
- The complete approved design is
  `docs/plans/2026-09-18-meta-ad-recommendations-settings-design.md`.
- Source methodology and evidence are outside this repository:
  `/Users/eli/Projects/marketing/albadi/account/tests.md` and
  `/Users/eli/Projects/marketing/albadi/account/performance/meta-ads.md`.
- Key decisions: recommendations only; exact Ad ID identity; suitable lead only
  from Eli's designated GHL tag; settings recalculate recommendations but never
  overwrite approved manual winner/loser state; Prospecting and Remarketing are
  separate; all live parameters belong in `מודעות → הגדרות בדיקה`.
- 2026-09-18: implementation plan written —
  `docs/plans/2026-09-18-meta-ad-recommendations-implementation.md` (5 phases,
  approved the same day). Established from prod: the GHL
  suitable-lead tag is `good lead` in `lead_tags` (15 leads);
  `meta_qualified_sent_at` is NOT the marker (reportable subset only); three
  ad names already have 2 Ad IDs each; no ad-set column on `leads`.
- Eli approved the plan: keep tag `good lead`; for a name with several Ad IDs
  the approved status goes only to the copy that produced the results.
- Phase 1 DONE — commit `f5f4733` (pure engine + settings + tests).
- Phase 2 DONE — migration `0004_ad_recommendations.sql`, settings store with
  revisions, review-state store with audit, 3 widget-token routes, read-only
  architecture test, integration test. Unit + typecheck + integration (191/191
  on a throwaway branch, deleted) green. **0004 is NOT applied to production.**
  Nothing calls the new routes yet, so prod is unaffected until the UI ships.
- Phase 3 DONE — Meta daily evidence by exact Ad ID, CRM evidence, assembly,
  `GET /api/widget/ads/recommendations`, and the daily alert job
  `ads-evidence` (`/api/cron/ads-evidence-check`, Vercel 06:30 UTC) that fails
  with a Hebrew reason → the watchdog WhatsApps Eli. Tests green (unit 630,
  integration 202 on a deleted throwaway branch).
- **DEPLOYED 2026-09-18 (Eli's OK):** migration 0004 applied to prod Neon
  (3 empty tables + 4 indexes verified); pushed `1924f60` to main; Vercel
  production deployment Ready. `META_ADS_TOKEN` is set in Vercel production —
  a SYSTEM USER token ("eli", business 1041177089073457, never expires); Eli
  ticked every scope, but the system user only holds the ad account (Manage
  campaigns) + the "Ads Automation" app. Two Meta tokens were pasted into chat
  — the first (Eli's personal user token) should be revoked.
- Also shipped: the existing ads report now shows spend — it joined `ag:`-prefixed
  `meta_ad_id` against bare Meta IDs (never matched) and took one copy's spend
  per name (C-magic-hat-trick ₪104 of ₪1,146). Verified live: total ₪4,324.
- `ads-evidence` job kicked by hand after deploy: ok, 69 ads, 368 Meta daily
  rows, heartbeat `lastStatus: ok`; watchdog dry-run clean for it. 66
  "conflicts" are expected — no approved statuses are seeded yet (every ad
  that spent reads "untested").
- Phase 4 DONE (commit `d0fa4d9`, NOT yet deployed): `/widget/ads` sub-tabs
  המלצות (default) · הגדרות בדיקה · דוח איכות לידים. Components
  `components/ads/AdRecommendationsView.tsx` + `AdRecommendationSettingsView.tsx`,
  help texts `lib/ads/settings-help.ts`; the API rows now carry `evidence` so the
  settings screen previews recommendation changes client-side before saving.
  Verified locally (no Meta token locally → the "no Meta data" state): validation,
  consistency warnings, reset diff, unsaved guard, decision editor, 390px probe
  clean. The data-filled view can only be seen in prod (token is prod-only).
- Next step: deploy Phase 4 (push to main) and eyeball `מודעות → המלצות` with
  real data in the GHL Hub. Then Phase 5: seed approved statuses from a reviewed
  Ad-ID mapping (Eli: status goes only to the copy that produced the results),
  header note in `tests.md`/`meta-ads.md`, add `ads-evidence` to
  `docs/agent/jobs.md`.

## Completed project — call analysis V2

## Current state

- The evidence-backed call analysis and action pipeline is implemented locally.
- The GHL widget is the canonical UI. The matching dashboard settings and drafts
  routes import the same widget components and do not maintain a separate UI.
- Operational behavior is controlled from the GHL settings screen, with Hebrew
  explanations for every control and explicit warnings for settings that may
  write to GHL.
- Safe launch defaults remain enabled: task mode is `shadow`, and status changes
  are recommendations only.
- The feature was pushed to `main`, migrated, and deployed to production on
  2026-09-17. Vercel deployment `dpl_88iZHmuZ1jGUkcFeFAVVsvfgPoqg` reached
  `Ready`.

## Commits

- `fe05a10` — sales transcript analysis V2 design
- `8597f90` — implementation plan
- `f0d8871` — evidence-backed call action pipeline
- `9f7ca55` — settings and approvals UI
- `f8c2d38` — rollout handoff
- `c0709be` — register the migration in Drizzle's journal

## Verification completed

- Unit suite: 513 passed, 2 expected failures.
- TypeScript typecheck passed.
- Integration suite on a throwaway Neon branch after applying the migration:
  176 passed.
- Production build on a throwaway Neon branch passed.
- Widget settings and call-action approvals were visually checked locally.
- Temporary Neon branches and the temporary local server were removed.

## Production rollout completed

- Applied `0003_call_action_candidates.sql` to the production Neon `main`
  branch. The table and all five expected indexes were verified.
- Pushed through `c0709be` to GitHub `main`; the GitHub-to-Vercel deployment
  completed successfully.
- Production HTTP checks passed: the site and settings route respond, and the
  pending-actions API rejects unauthenticated requests with `401`.
- The existing Chrome session loaded the deployed Albadi Hub with live data.
- Effective launch behavior is safe: task mode falls back to `shadow`, WON and
  LOST remain recommendations, and no automatic task/status write is enabled.
- Both affected job heartbeats reported successful runs after deployment:
  `process-recordings` at `2026-09-17T17:11:50.155Z` and `elevenlabs-sync` at
  `2026-09-17T17:11:44.686Z`.
- There were zero call-action candidates immediately after deployment.

## Next operational step

1. Keep shadow mode active until at least 30 calls have been labeled and
   reviewed for precision.
2. Review new candidates under the GHL Hub approvals tab.
3. Promote to approval or hybrid mode only from settings after the pilot review;
   do not change WON/LOST to automatic.

## Unrelated local work

The remaining modified and untracked files shown by `git status` predate this
feature or belong to other work. They were deliberately excluded from the four
commits above and must not be overwritten or bundled into this rollout.
