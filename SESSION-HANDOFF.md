# Session handoff

## OPEN — Google Ads in the CRM: phase 1 LIVE (2026-09-23), next = phase 2

Plan: `docs/plans/2026-09-23-google-ads-tab-design.md`. Eli: platform switch מטא|גוגל in ads + settings split;
reuse the marketing repo's Google Ads credentials (approved 23/09); go step by step.
Phase 1 shipped — 0005 applied to prod (9 columns verified), commit 9aea591 on main, Vercel Ready: `lib/leads/google-click.ts` (+10 unit tests), 9 columns in `drizzle/schema.ts`,
`drizzle/migrations/0005_google_click_attribution.sql` (+journal idx 5), website-import writes them blanks-only,
`tests/integration/website-import-google.test.ts` (passed on a throwaway Neon branch). `npm test` 706 ✓, typecheck ✓.
**Verify on the next real website lead:** its row has google_gclid/utm_* filled. Backfill dropped: only 2 notes ever carried a gclid, both `smoke-test` MaxBaby leads.
**Finding:** no real website lead with a gclid ever reached the CRM — to investigate in phase 3 (tracking chain).

## OPEN — estimator per-factory gate: verify the first nightly run (2026-09-22)

Deployed to main on Eli's OK. The nightly refit now judges and publishes MANDY
and WEIWEI each on its own quotes (`gateFactory`). **Next step:** after the 04:00
run, check the WhatsApp has one line per factory and Settings → "דיוק המחשבון"
shows "דיוק המחיר — MANDY" and "— WEIWEI" (the refit writes
`factories[f].accuracy` on that run). Dry run before deploy: MANDY 4.5% (22),
WEIWEI 5.0% (10). Eli's decision: no change to formulas/envelope/refusals.
Record + 5 open questions: `docs/archive/research/estimator/2026-09-22-OBSERVATIONS.md`.

## Completed project — hub redesign per ui-ux-pro-max (2026-09-18)

Rule (AGENTS.md): every UI change follows `~/.claude/skills.cold/ui-ux-pro-max`
inside Silent Luxury. How-to + all decisions: `docs/agent/mobile-ui.md`
("UI design rules", "The `.ux-*` layer", "Structural pass over the remaining tabs").

**Every hub tab is done & live** (main, deployed; probe clean on all 11 tabs at
375 and 1280 — only false positive: dark text on champagne buttons):
מודעות, אנליטיקה, הגדרות, שיחות (list + new ConversationThread), הצעות מחיר,
עסקאות, מחיר מתחרים, מחשבון, צבעים, צירוף משלוחים, מגרש בדיקות. אישורים tab
deleted. 3D designer keeps its own light theme by design.

Bugs fixed on the way (18/09, second session): calculator summary "נטו" showed
the gross profit; boss-table commission base used rounded shipping (₪0.43 off);
LuxShell `overflow:auto` broke every sticky element; shipping planner offered
soft-deleted quotes; playground tab hydration mismatch; estimate "הורד PDF"
actually sent the PDF on WhatsApp (relabelled "שלח אומדן PDF").

**Open:**
1. Check on the phone in GHL that the bottom bar and the new screens feel right
   (verified in emulation only; prod needs the GHL widget token).
2. Modals inside הצעות מחיר (FinalizeModal, CombinedCalcModal, HistoryDetail,
   Spec/Estimate) got only the compliance pass, not a structural redesign.
3. If call analysis ever leaves "צל" mode, rebuild an approval screen first
   (the אישורים tab is gone).

## Completed project — Meta ad recommendations (2026-09-18)

- Live in production: `מודעות` tab → המלצות · הגדרות בדיקה · דוח איכות לידים,
  one health status line on every sub-tab. Recommendation-only; nothing writes
  to Meta. Full reference: `docs/agent/meta-and-leads-intake.md` → "Ad
  recommendations"; design + plan in `docs/plans/2026-09-18-meta-ad-recommendations-*`.
- Approved statuses seeded for 28 Ad IDs from the `meta-ads.md` registry
  (winners `07_chain_cut`, `C-magic-hat-trick` = Control; losers
  `concept-5-daylight-two-bags`, `remarketing-quote-reminder`; the rest
  "testing"), 58 audit rows. Status sits only on the copy that produced results.
- Open decisions for Eli, visible as the only 2 conflicts on the screen:
  - `C-magic-hat-trick`: approved winner (Eli, 17/09) but CAC ₪521 > ₪500.
    Recommended: KEEP as winner — 2 deals, ₪1,958 contribution after ads,
    ~2.9:1; re-examine only if more spend without a deal pushes CAC well up.
  - `08_layers_peel`: winner candidate (1 deal, CAC ₪145). Recommended: do NOT
    approve yet — meta-ads.md says its creative has invented layer
    percentages and "מחיר מפעל" and must not run as-is. Fix the claims, then
    relaunch as the Challenger.
- Scheduled jobs moved to cron-job.org on 18/09 (all seven; verified runs +
  heartbeats, see docs/agent/jobs.md). `resume-sweep` confirmed hourly on
  19/09 (16:00, 17:00, 18:00 all 200). Neon CLI now uses an API key (ops.md).
- `META_ADS_TOKEN` = System User "eli" (never expires). Eli pasted two Meta
  tokens into chat; the first (his personal user token) should be revoked.
- Header notes added to `marketing/albadi/account/tests.md` and
  `performance/meta-ads.md` (live values are in the CRM) — left UNCOMMITTED in
  the marketing repo, which had other uncommitted work in those files.
- 18/09 late: Elran's Purchase (closed 03/09, never stamped — fire-and-forget
  send) was sent to Meta (retry: sent 1, failed 0); the send is awaited now and
  the retry/health also catch never-stamped deals. The daily ads-evidence job
  now fails on ANY red ads-health line → watchdog WhatsApp. Prod run after
  deploy: 200, all green. The failure → WhatsApp path was not fired live.
- Also fixed on the way: ads report never showed spend (`ag:` IDs, one copy per
  name); failed Purchase reports now retry daily (סהר צור resent ₪5,732.04).

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
