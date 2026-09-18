# Session handoff

## Paused project — hub redesign per ui-ux-pro-max (2026-09-18)

Rule (AGENTS.md): every UI change follows `~/.claude/skills.cold/ui-ux-pro-max`
inside Silent Luxury. How-to + all decisions: `docs/agent/mobile-ui.md`
("UI design rules", "The `.ux-*` layer", "Compliance pass over every tab").

**Done & live (all on main, deployed, probe-verified at 375 / 812×375 / 1280):**
- Rebuilt: מודעות (+ דיווח למטא), אנליטיקה, הגדרות (side nav, one save bar;
  ads test rules moved here), שיחות (WhatsApp-style list), מחיר מתחרים
  (verdict in words, live KPIs, cards on phone, delete with confirm + 6s undo),
  עסקאות (KPIs with meaning, one-line progress per deal).
- Hub tab bar: 44px tabs; phone bottom bar = שיחות · הצעות מחיר · עסקאות + עוד.
- אישורים tab DELETED (queues never used: 484 escalations, 0 drafts).
  `isDraftQueueEnabled()` is hard-off. Call-analysis "תמיד לאישור"/"משולב"
  modes now have no approval screen — rebuild one before leaving "צל".
- Compliance pass (text ≥12px, taps ≥44px, contrast ≥4.5:1, no sideways
  scroll) on הצעות מחיר, מחשבון, משלוחים, צבעים, מגרש בדיקות.

**Next (Eli to pick when we resume):**
1. Deeper structural redesign of one of: הצעות מחיר, מחשבון, משלוחים, צבעים,
   מגרש בדיקות (so far only the compliance pass).
2. The full-conversation screen (InboxView thread) — passes the probe, not
   redesigned.
3. Check on the phone in GHL that the bottom bar and the new tabs feel right
   (verified in emulation only; prod needs the GHL widget token).

**Housekeeping:** local branch `ui/hub-redesign` diverged from main only by
duplicate commits (content identical) — safe to delete. Obsolete WIP patch
for the deleted אישורים redesign is in the Claude scratchpad; ignore it.

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
  heartbeats, see docs/agent/jobs.md). Still to confirm: `resume-sweep`'s
  first hourly run from cron-job.org, and that the watchdog stays quiet.
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
