# Session handoff

## Pending project — Meta ad recommendations

- Eli approved a design for a recommendation-only decision engine inside the
  canonical GHL Hub `מודעות` widget.
- No production database, setting, or Meta object has been changed for this
  project. Code for Phases 1–2 is committed locally (see below).
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
- Next step: Phase 3 — Meta daily evidence by exact Ad ID (paginated insights,
  `action_type=lead` only, `fetchAdStatuses`), CRM evidence by normalised
  `meta_ad_id` + `lead_tags` tag + closed deals, assembly + `GET
  /api/widget/ads/recommendations`. Apply 0004 to prod only with Eli's OK,
  before the Phase 4 UI deploys.

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
