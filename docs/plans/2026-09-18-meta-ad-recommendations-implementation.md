# Meta Ad Recommendations — Implementation Plan

**Date:** 2026-09-18
**Status:** Approved by Eli 2026-09-18. Phase 1 done (`f5f4733`); Phase 2 done (code + tests, migration NOT yet applied to prod); Phases 3–5 pending
**Approved design:** `docs/plans/2026-09-18-meta-ad-recommendations-settings-design.md`
**Methodology sources (read-only, never loaded at runtime):**
`/Users/eli/Projects/marketing/albadi/account/tests.md`,
`/Users/eli/Projects/marketing/albadi/account/performance/meta-ads.md`

## Facts established while planning (production DB, 2026-09-18)

| Question | Answer | Consequence |
|---|---|---|
| Which GHL tag marks a suitable lead? | `good lead` — the only good-lead spelling in `lead_tags` (15 leads) | Default `suitableLeadTag = "good lead"`, editable. Source = `lead_tags`, mirrored from GHL by `resyncContact`. |
| Can `meta_qualified_sent_at` be the marker? | **No.** 13 rows = the subset that was *reportable to Meta*. Every one is also tagged (0 stamped without the tag) | Never count suitable leads from `meta_qualified_sent_at`; it undercounts leads with no leadgen id/fbclid. |
| Leads with an ad name but no ad ID | 0 of 270 attributed leads | The "missing Ad ID" path is a guard, not a common case. |
| Same name, several IDs | Already live: `C-magic-hat-trick` (2), `מודעה 1 — מחיר \| אמצע הדרך` (2), `מודעה 4 — אספקה \| הבטחות ריקות` (2) | The current report's `GROUP BY meta_ad_name` merges these. The new engine groups by `meta_ad_id` only. |
| Format of `leads.meta_ad_id` | Stored with an `ag:` prefix (`ag:120252199875770562`); Meta Insights returns the bare ID | Normalise with one `normalizeAdId()` (strip `ag:`) on every join, with a unit test. The current report joins raw values, so its spend lookup probably never matches — check that separately. |
| Same name, two IDs — example | `C-magic-hat-trick`: `…875770562` in the lead-form campaign (89 leads) and `…958722930562` in "Advantage+ מנצחות" (3 leads) | Two separate ads with separate evidence and separate approved status. |
| Suitable-lead tag | Eli confirmed 2026-09-18: keep `good lead` | Default setting value. |
| Ad set on the lead row | No column exists (`meta_ad_id`, `meta_campaign_id` only) | Ad set ID/name comes from Meta by ad ID; no lead-table migration needed. |
| Existing config keys `ads.*` | None | `ads.recommendation.settings` is free. |
| Standalone/dashboard alias for `/widget/ads` | None | Nothing to keep in parity; if one is added later it must import the widget component. |

The suitable-lead count is only as fresh as the GHL→DB tag mirror. The
`ContactUpdate`/`ContactTagUpdate` webhooks run `resyncContact`, so a new tag
normally lands within seconds. If they drift, the fix is the resync, not a
second path.

## Guiding order

Pure contract first, then persistence, then data, then UI — the same
order as the design's rollout section. Every phase leaves `main` deployable,
and the existing `מודעות` report keeps working until the new sub-tab replaces
its default view.

---

## Phase 1 — Pure settings schema + recommendation engine (no DB, no network)

### Files

- `lib/ads/recommendation-settings.ts` — client-safe, no server imports (the
  settings screen needs the defaults and the validator).
  - `AdRecommendationSettings` type, `SETTINGS_SCHEMA_VERSION = 1`.
  - `APPROVED_DEFAULTS_2026_09_18` — every value from the design tables:
    economics (1500 / 3 / 500 / 12.5 / 40 / dealOverridesCplStop=true),
    gates (100 / 8 / 5 / 4 / 250 / 500 / 14 days / ₪20 daily),
    suitable-lead (`suitableLeadTag: "good lead"`,
    `qualityOverrideMinSuitable: null`, `allowQualityOverride: false`),
    structure (4 / 2 / 1 / 1 / evaluateRemarketingSeparately=true),
    winner/loser (minDeals 1, winnerRequiresCacAtOrBelowTarget=true,
    loserRequiresMaturation=true).
  - `validateSettings(raw): { ok: true; value } | { ok: false; errors: HebrewError[] }`
    — zod, but **no silent stripping into a lie**: unknown keys are an error,
    not dropped (see memory "Zod strips what it doesn't list").
    Rules: all money > 0; `firstGateSpend < stabilitySpend < dealProofSpend`;
    `stopMax < reviewMin <= passLeads - 1` (i.e. 4 < 5 ≤ 7 with pass 8 — the
    bands cannot overlap or leave a gap); `controlSlots + challengerSlots +
    remarketingSlots <= maxActiveAds`; `allowQualityOverride` requires a
    non-null `qualityOverrideMinSuitable >= 1`; tag non-empty after trim.
  - `consistencyChecks(settings)` → warnings only (`1500/3 ≠ maxCac`,
    `maxCac/leadsPerDeal ≠ targetCpl`). Never mutates values.
  - `settingsToMarkdown(settings, revision)` — the copyable summary.
- `lib/ads/recommendation-engine.ts` — pure.
  - Input `AdEvidence`: `adId`, `adSetId`, `adName`, `adSetName`,
    `campaignId`, `segment: "prospecting" | "remarketing" | null`,
    `role: "control" | "challenger" | "remarketing" | null`,
    `spendIls` (unrounded), `metaLeads` (`action_type=lead` only),
    `crmLeads`, `suitableLeads`, `deals`, `dealRevenueExVat`,
    `firstSpendDate`, `lastSpendDate`, `deliveryDays`,
    `dailyHistoryComplete: boolean`, `identityIssues: string[]`.
  - `recommend(evidence, settings, now)` →
    `{ code, gate, reasons: HebrewReason[], metrics: {cpl, cac, contributionAfterAds} }`.
    `code` is the closed 13-value union from the design; rule priority exactly
    as the design lists it (identity/evidence block → deal first → final spend
    & maturation → stability → first gate → collecting).
  - Each reason is `{ key, text, numbers }` so the UI prints the plain-Hebrew
    sentence and tests assert on `key`, not on prose.
  - Never returns `winner_candidate`/`loser_candidate` when
    `identityIssues.length > 0` or `dailyHistoryComplete === false`.
- `lib/ads/structure-check.ts` — pure. Counts active ads (read-only Meta
  `effective_status === "ACTIVE"`) per role and segment against the slot
  settings; returns warnings (`3 Controls פעילות, מוגדרות 2`).

### As built (2026-09-18) — differences from the list above

- `AdEvidence` takes Meta's **daily rows** (`{date, spendIls, metaLeads}`)
  instead of pre-aggregated spend/dates; the engine derives spend, delivery
  days, first/last spend date and the per-gate crossings itself
  (`computeMetrics`). Display fields (names, ad set, segment, role) are not
  engine input — they belong to the assembly layer in Phase 3.
- `recommend(evidence, settings, today)` takes `today` as `YYYY-MM-DD`, so it
  stays clock-free and client-safe. Reasons are `{key, text}`.
- Added `lib/ads/ad-id.ts` (`normalizeAdId`, strips `ag:`).
- Finding while testing the 18/09 snapshot: `C-magic-hat-trick` (CAC
  ₪516.64) comes out `deal_economics_review`, not `winner_candidate`, because
  it is above the ₪500 ceiling. Correct under the approved rules; it will show
  as a conflict against its approved `winner` status.
- 63 tests in `lib/ads/*.test.ts`; full suite 576 passed + 2 expected fails;
  `tsc` clean.

### Decisions that close gaps in the design

1. **Gates are cumulative lifetime per Ad ID, judged at the crossing.**
   Independent of the tab's 30/90/all filter (`tests.md`: "עד ₪100 מצטברים
   למודעה"). From Meta's daily rows the engine finds the day cumulative spend
   reached each gate and uses the leads *through that day* — an ad at ₪180 is
   judged on what it had at ₪100. The crossing day counts whole.
2. **The first-gate review band stays `quality_review` until the stability
   gate.** The engine never infers passage from the band and does not read the
   approved manual status (default `testing` would pass every historic ad).
   Only a configured quality override lets it through automatically.
3. **At stability**, `continue_to_deal_proof` requires `cpl <= targetCpl`
   (strict boundary tested both sides). The design's "close to target" is not
   invented into a tolerance; if Eli wants one it becomes a setting.
4. **Unassigned segment** → the ad still gets a gate recommendation but is
   excluded from both rankings and slot counts, with a "לא סווג" warning.
   No segment is guessed from the campaign name.

### Tests (`*.test.ts` next to each module)

Table-driven, one row per boundary from the design's testing section: ₪99.99
vs ₪100; 4/5/7/8 leads at the first gate; CPL equal to / 1 agora above target;
a deal overriding `early_stop`; CAC equal / below / above ₪500; ₪500 with no
deal on day 13 vs day 14 after `lastSpendDate`; override never applied while
the threshold is null; partial daily history never yields winner/loser;
identity issue blocks everything; validator rejects each impossible range with
its Hebrew message; unknown keys rejected; consistency warnings do not alter
values. Plus a regression row built from the real 2026-09-18 snapshot
(`07_chain_cut` ₪799.28 / 67 leads / 2 deals → `winner_candidate`;
`concept-5` ₪588 / 55 leads / 0 deals / last spend 01/09 → `pause_and_mature`
until 15/09, then `loser_candidate`).

**Exit check:** `npm test`, `npm run typecheck`. Nothing deployed changes.

---

## Phase 2 — Persistence + authenticated APIs

### Migration `drizzle/migrations/0004_ad_recommendations.sql`

Registered in `drizzle/migrations/meta/_journal.json` (the step `c0709be` had
to fix after the fact last time). Direct SQL, not `drizzle-kit push`.

```sql
CREATE TABLE ad_recommendation_policy_revisions (
  revision     integer PRIMARY KEY,
  settings     jsonb NOT NULL,
  previous     jsonb,
  changed_keys text[] NOT NULL,
  actor        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad_review_state (
  ad_id           text PRIMARY KEY,
  ad_set_id       text,
  segment         text CHECK (segment IN ('prospecting','remarketing')),
  role            text CHECK (role IN ('control','challenger','remarketing')),
  approved_status text NOT NULL DEFAULT 'untested'
                  CHECK (approved_status IN ('untested','testing','winner','loser')),
  decision_reason text,
  decided_by      text,
  decided_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad_review_state_audit (
  id bigserial PRIMARY KEY,
  ad_id text NOT NULL,
  field text NOT NULL,           -- approved_status | segment | role
  old_value text, new_value text,
  reason text, actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_review_state_audit_ad_idx ON ad_review_state_audit (ad_id, created_at DESC);
```

Current policy lives in `app_config` key `ads.recommendation.settings`
(`{schemaVersion, revision, settings, updatedAt, actor}`); history in the
revisions table. Tables added to `drizzle/schema.ts`.

### Server modules

- `lib/ads/settings-store.ts` — `getAdRecommendationSettings()` (normalises
  the stored doc; a missing row returns the approved defaults as revision 0,
  an invalid stored doc logs `error` and returns the last valid revision).
  `saveAdRecommendationSettings(raw, {expectedRevision, actor})`: validate →
  one transaction-equivalent write (insert revision row with
  `revision = expected + 1`; the PK makes a concurrent save fail rather than
  overwrite) → upsert `app_config`. Invalid input writes nothing.
  ⚠️ Neon's HTTP driver has no multi-statement transaction here; the revision
  PK is the atomicity guard, and the `app_config` upsert only runs after the
  revision insert succeeds.
- `lib/ads/review-state-store.ts` — `listReviewState()`,
  `setReviewState(adId, patch, {reason, actor})`: writes the row and one audit
  row per changed field. `approved_status` changes require a non-empty reason.

### Routes (all `withRequestLog("meta", …)`, all `verifyWidgetToken`)

| Route | Method | Purpose |
|---|---|---|
| `app/api/widget/ads/recommendation-settings/route.ts` | GET | current settings, revision, defaults, consistency warnings, Markdown |
| same | PUT | `{settings, expectedRevision}` → 200 / 400 Hebrew errors / 409 stale revision |
| `app/api/widget/ads/review-state/[adId]/route.ts` | PUT | `{approvedStatus?, segment?, role?, reason}` |
| `app/api/widget/ads/recommendations/route.ts` | GET | computed rows (Phase 3 fills evidence) |

No route accepts a Meta object mutation, and none imports a Meta write helper.
An architecture test (below) enforces that.

### Tests

- `tests/integration/ads-recommendation-settings.test.ts` (throwaway Neon):
  GET defaults; PUT valid → revision 1 + history row; PUT invalid → 400 and
  nothing written; PUT with stale `expectedRevision` → 409; review-state audit
  rows; changing settings leaves every `approved_status` untouched.
- `tests/integration/route-gates.test.ts`: the new routes land in the
  `own-gate` bucket (widget token) and the no-credential → 401 sweep covers
  every method.
- `tests/unit/architecture/ads-read-only.test.ts`: no file under `lib/ads/`,
  `app/api/widget/ads/`, `components/ads/` contains a Graph POST/DELETE or the
  strings `status=PAUSED|ACTIVE`, `daily_budget`, `/copies`.

**Exit check:** unit + integration green on a `ci-local` branch; migration
applied to production only after Eli's OK (standard prod-DB write rule).

### Phase 2 as built (2026-09-18)

- `drizzle/migrations/0004_ad_recommendations.sql` (+ journal idx 4) —
  idempotent `IF NOT EXISTS`, CHECK constraints on segment/role/status and a
  digits-only `ad_id`. **Not applied to production yet.**
- `lib/ads/settings-store.ts` — a save is ONE statement (data-modifying CTE:
  insert revision `ON CONFLICT DO NOTHING` → upsert `app_config` only if the
  insert happened), so history and current policy cannot disagree and a race
  from the same `expectedRevision` yields exactly one winner (tested with two
  concurrent PUTs). Invalid stored doc → falls back to the newest valid revision.
- `lib/ads/review-state.ts` (pure validation, `validateReviewPatch`) +
  `lib/ads/review-state-store.ts` — one CTE reads the old row, upserts, and
  appends an audit row per field that actually changed.
- Routes (all `withRequestLog("meta")` + `widgetAuthed`, own-gate bucket, swept
  automatically): `GET|PUT /api/widget/ads/recommendation-settings`,
  `GET /api/widget/ads/review-state`, `GET|PUT /api/widget/ads/review-state/[adId]`.
  Actor is recorded as `widget` (the widget has no per-user identity).
- `GET /api/widget/ads/recommendations` moved to Phase 3 — it has nothing to
  return until the evidence exists.
- `tests/unit/architecture/ads-read-only.test.ts` — forbids Graph writes,
  status/budget fields and `/copies` in the feature's files.
- `tests/integration/ad-recommendations.test.ts` applies 0004 itself (CI
  branches from prod, which lacks the tables until the prod apply) and restores
  the branch's prior policy afterwards.
- Verified: unit 581 + 2 expected fails; typecheck clean; integration 191/191
  on throwaway branch `ci-local-ads` (deleted).

---

## Phase 3 — Exact-ID evidence

### Meta (read-only, `META_ADS_TOKEN`, `ads_read` only)

Extend `lib/meta/ads-insights.ts` without changing `fetchAdSpend`'s contract
(the old report keeps using it):

- `fetchAdDailyEvidence()` — `/{act}/insights?level=ad&time_increment=1&date_preset=maximum`
  fields `ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,actions`;
  follows `paging.next` to the end (the current function reads one page of
  500 and would silently truncate daily rows). Leads = the `actions` entry with
  `action_type === "lead"` only — never a sum of the array.
  Returns per ad: unrounded lifetime spend, Meta leads, first/last date with
  `spend > 0`, delivery-day count, `dailyHistoryComplete` (false on any page
  error or when the earliest row equals the preset's first day, i.e. history
  may be clipped).
- `fetchAdStatuses()` — `/{act}/ads?fields=id,name,adset_id,effective_status`
  paginated.
- Same 10-minute in-process cache. Token/HTTP errors return
  `{unavailable: reason}`; the engine then emits
  `insufficient_or_conflicting_data` for every row, never a winner/loser.

### CRM — `lib/ads/crm-evidence.ts`

One query grouped by `meta_ad_id` (never by name):
`crm_leads`, `suitable_leads` = `EXISTS lead_tags WHERE tag = $configuredTag`
(exact match on the configured tag), plus deals from `listClosedQuotes()`
joined sid → `meta_ad_id` (the same canonical `grandTotalExVat` and
`closed_deal_at`-or-WON rule the current report uses). Also returns: leads with
`meta_ad_name` but no `meta_ad_id` (→ `לא ניתן להכריע`), and every name that
maps to more than one ID (→ identity warning on each of those rows).

### Assembly — `lib/ads/build-recommendations.ts`

Joins Meta evidence ∪ CRM evidence ∪ `ad_review_state` by Ad ID (an ID present
on only one side still gets a row), runs `recommend` + `structure-check`,
returns rows + policy revision + data-health block + input timestamp. Logs
`ads_recommendations.computed` with counts per code and identity warnings
(no names, no customer data).

### Tests

Unit: `actions` parsing (lead vs `onsite_conversion.lead_grouped` etc.),
pagination merge, delivery-day counting, join with one-sided IDs, same-name
two-ID case stays two rows. Integration: seeded `test:ci-*` leads with tags
and a closed quote, Meta fetch stubbed.

---

## Phase 4 — UI inside `מודעות`

- `app/widget/ads/page.tsx` gains `?view=recommendations|settings|report`
  sub-tabs; **default = `המלצות`**, the current table moves under `דוח`
  unchanged (it still has value and removing it is a separate decision).
- `components/ads/RecommendationsView.tsx` (client) — Prospecting and
  Remarketing sections, slot usage strip, filters, one card per Ad ID with
  every field the design lists, conflict badge when recommendation ≠ approved
  status, "שמור סטטוס מאושר" dialog requiring a reason. Latin IDs/names in
  `unicodeBidi: "isolate"`.
- `components/ads/RecommendationSettingsView.tsx` (client) — grouped inputs,
  a Hebrew explanation line per input (controls / unit / where it affects /
  entered-or-derived / when unset), the top banner
  "ההגדרות משנות המלצות בלבד. הן אינן מפעילות או עוצרות מודעות ב-Meta.",
  consistency warnings, unsaved-change guard, reset that shows the exact
  2026-09-18 values before confirming, revision + last-changed, copy Markdown.
  Live preview: the view re-runs the pure engine client-side on the draft
  settings against the evidence it already fetched, so a change visibly
  recalculates before saving.
- Mobile: the `.mfit` rules; cards not wide tables; `lux-tap` on small text
  buttons; inputs ≥16px.

Verification: local `albadi-crm-data-dev` (live prod DB — **read only**; do
not press save against prod), desktop + 390 px, the overflow/font-size probe
from `CLAUDE.md`, loading/empty/stale/error/conflict states forced via a
fixture route.

---

## Phase 5 — Seed, deploy, compare

1. Apply `0004` to production (after Eli's OK).
2. Seed script `scripts/seed-ad-review-state.ts` (dry-run by default, `--go`):
   approved statuses from `meta-ads.md`'s "רישום הסטטוס המאושר" — winners
   `07_chain_cut`, `C-magic-hat-trick`; losers `concept-5-daylight-two-bags`,
   `remarketing-quote-reminder`; the 13 `testing` names. **The registry is by
   name and some names have several IDs**, so the script prints every
   name → [ID, ad set, spend] candidate and writes only the IDs Eli confirms
   in a reviewed mapping file (`scripts/data/ad-review-seed.json`). Nothing is
   seeded by name match alone. Segment/role likewise from that file.
3. Save revision 1 = approved defaults (actor `seed:2026-09-18`).
4. Deploy; open `מודעות → המלצות` in the GHL Hub and compare each row with the
   "יישום ראשוני של כלל הבדיקה" table in `meta-ads.md`. Every disagreement is
   either an engine bug or a documented rule gap — written down, not waved away.
5. Update the two marketing Markdown headers to say the live parameters are in
   the widget (separate repo; separate commit).
6. `CLAUDE.md` section + regression test per the "incident → test" rule.

## Observability

Feature `meta` (already in `FEATURES`). Events: `ads_settings.read`,
`ads_settings.saved {revision, changedKeys}`, `ads_settings.rejected {errors}`,
`ads_review_state.changed {adId, field}`, `ads_recommendations.computed
{counts}`, `ads_evidence.meta_unavailable {reason}`. No new cron, so no
`withJob`/`JOBS` entry and no WhatsApp alert — the screen is computed on open.

## Not in scope

- Any Meta write (status, budget, duplication). Enforced by the architecture test.
- Recommendation snapshots table (design: only "if needed for analysis").
- A quality-override threshold value — the setting exists, stays `null`/off
  until Eli sets it.

## Open questions for Eli before Phase 5 (not blocking Phases 1–4)

1. Is `good lead` the tag you apply today, or do you want a new Hebrew tag
   (e.g. `ליד מתאים`)? The setting supports either; changing it later just
   changes which leads count.
2. For names with two IDs (form + WhatsApp copies), which ID carries the
   approved status — both, or only the one you intend to run?
