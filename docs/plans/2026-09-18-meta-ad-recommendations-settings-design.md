# Meta Ad Recommendations and Settings — Design

**Date:** 2026-09-18  
**Status:** Approved design; implementation has not started  
**Canonical UI:** GHL Hub widget, `מודעות` tab  
**Decision mode:** Recommendations only; never mutate Meta campaigns, ad sets,
or ads

## Source material

This design was derived from:

- `/Users/eli/Projects/marketing/albadi/account/tests.md`
- `/Users/eli/Projects/marketing/albadi/account/performance/meta-ads.md`

Those files describe the approved testing method and the historical evidence
available on 2026-09-18. They are not suitable as a live runtime dependency:
Vercel cannot safely treat files from another local project as editable
configuration.

The live operational numbers must have one source of truth: the settings inside
Albadi's `מודעות` widget. The marketing documents remain methodology,
rationale, snapshots, and decision history. Their headers should eventually say
that the live parameters are in the widget, so an agent never treats an old
number in Markdown as the current production value.

## Goal

Turn the existing ads report into an explainable decision-support screen that
answers, for every exact Meta ad:

1. what evidence exists;
2. which testing gate the ad has reached;
3. what the current policy recommends;
4. why it recommends that action;
5. whether Eli has already assigned a manual, approved status.

All policy numbers and structural constraints must be editable inside the ads
tab. Changing a setting recalculates recommendations immediately. It must never
silently overwrite an approved historical status.

## Non-goals and safety boundaries

- Do not activate, pause, edit, duplicate, budget, or otherwise mutate Meta
  objects.
- Do not create an automatic approval path later by accident. A future Meta
  write integration requires a separate design and explicit authorization.
- Do not infer that a lead is suitable from a pipeline stage, conversation,
  score, or model. A suitable lead exists only when Eli applies the designated
  GHL tag.
- Do not declare an approved winner or loser automatically.
- Do not compare remarketing and prospecting in the same ranking.
- Do not group decisions by ad name. Names are duplicated across Lead Form and
  WhatsApp objects. Decisions use exact Meta Ad ID and Ad Set ID.
- Do not make the CRM application import or read the two marketing Markdown
  files at runtime.

## Approved operating model

The system has two separate layers:

### Live recommendation

A deterministic recommendation is recalculated from current Meta data, CRM
outcomes, and the current policy settings. It may change when performance data
or settings change.

### Approved manual status

Eli may assign one of:

- `untested` — לא נוסתה;
- `testing` — בבדיקה / אין הכרעה;
- `winner` — מנצחת;
- `loser` — מפסידה.

This status is historical business state. Recalculation never changes it. The
screen may show that the live recommendation conflicts with the approved
status, but only a new manual decision may update the status.

## Source of truth and ownership

| Information | Owner |
|---|---|
| Spend, impressions, clicks, Meta leads, delivery dates, effective status | Meta, read-only |
| Suitable lead | The designated GHL tag applied by Eli |
| Deal and deal value | Albadi CRM / GHL operational data, using the existing canonical closed-deal calculation |
| Policy settings and revisions | Albadi DB |
| Per-ad segment, test role, exact IDs, and approved manual status | Albadi DB |
| Live recommendation | Derived by deterministic Albadi code |
| Methodology and rationale | `tests.md` |
| Historical performance snapshots and approved marketing decisions | `meta-ads.md` |

The GHL Hub is only the host for the canonical Albadi widget. These settings are
not GHL Contact or Opportunity custom fields.

## UI design

The canonical `מודעות` widget receives two sub-tabs.

### המלצות

This is the default view. It contains:

- a policy summary and the active policy revision;
- separate Prospecting and Remarketing sections;
- current slot usage, such as `2/2 Controls`, `1/1 Challenger`, and `0/1
  Remarketing`;
- one decision card or table row per exact Ad ID;
- filters for recommendation, approved status, segment, and role;
- a visible warning when exact IDs are missing or multiple same-name objects
  could be confused;
- a visible conflict state when the live recommendation differs from the
  approved manual status.

Each ad shows:

- ad name, Ad ID, Ad Set name, and Ad Set ID;
- Prospecting or Remarketing;
- Control, Challenger, Remarketing slot, or no role;
- effective Meta status, read-only;
- spend, delivery days, first spend date, and last spend date;
- Meta leads, suitable leads, and CRM deals;
- CPL, CAC, contribution after ad spend, and relevant quality rate;
- current testing gate;
- recommendation label;
- a plain-Hebrew numerical explanation;
- approved manual status and its decision date.

Example explanation:

> הוצאה ₪104, שני לידים, CPL ₪52. יעד ה-CPL הוא ₪12.50 ובשער הראשון
> נדרשים לפחות 5 לידים לבדיקה ידנית. מומלץ לעצור מוקדם.

Changing an approved status is an internal CRM decision only. It must require an
explicit save action and store the previous value, new value, reason, actor, and
time. It does not call Meta.

### הגדרות בדיקה

The screen groups settings by purpose and explains, beside every input:

- what it controls;
- the current value and unit;
- where it affects recommendations;
- whether it is derived or entered directly;
- what happens when it is unset.

The top of the screen states clearly:

> ההגדרות משנות המלצות בלבד. הן אינן מפעילות או עוצרות מודעות ב-Meta.

The screen includes save, reset-to-approved-2026-09-18-defaults, unsaved-change
warning, policy revision, last changed time, and a Markdown summary that can be
copied into strategy documentation. Reset must show the exact values before it
is confirmed.

## Configurable policy

Store the current policy under a dedicated Albadi configuration key such as
`ads.recommendation.settings`. Do not mix it into bot settings.

### Economics

| Setting | Initial value | Meaning |
|---|---:|---|
| Contribution profit per first deal | ₪1,500 | Estimated contribution before advertising and overhead |
| Target LTGP:CAC ratio | 3:1 | Rationale for the CAC ceiling |
| Maximum acceptable CAC | ₪500 | Current decision ceiling; editable directly |
| Target CPL | ₪12.50 | Current early-filter target |
| Expected leads per deal | 40 | Current observed planning assumption |
| Deal overrides CPL-only stop | Yes | A real CRM deal blocks a recommendation based only on CPL |

The UI may show derived consistency checks, for example `₪1,500 / 3 = ₪500`
and `₪500 / 40 = ₪12.50`, but it must not silently overwrite a directly edited
value. If the numbers disagree, show a warning and retain the saved values.

### Testing gates

| Setting | Initial value | Meaning |
|---|---:|---|
| First filter spend | ₪100 | First decision gate |
| First-gate pass leads | 8 | Clear pass at the first gate |
| First-gate review minimum | 5 | Start of the 5–7 suitable-lead review band |
| First-gate stop maximum | 4 | Early-stop recommendation at or below this count |
| Stability spend | ₪250 | Second gate |
| Deal-proof spend | ₪500 | Final paid-testing gate |
| Maturation days after stopping spend | 14 | Wait for an existing lead to close before loser recommendation |
| Reference daily budget | ₪20 | Used for expected-duration display, not for changing Meta budgets |

The schema validator must reject overlapping or impossible ranges and enforce
ascending spend gates. The UI should explain validation errors in Hebrew.

### Suitable-lead evidence

| Setting | Initial value | Meaning |
|---|---:|---|
| Suitable-lead GHL tag | Resolve the existing production tag | The only source for `ליד מתאים` |
| Minimum suitable leads for a quality override | Unset | Optional future rule for passing a borderline or stability gate |
| Allow quality override | No until the threshold is explicitly configured | Prevents inventing a quality threshold not present in the approved documents |

The approved source documents say that borderline ads require a quality check,
but do not define a numeric suitable-lead threshold. Therefore the initial
implementation must not invent one. Until Eli sets the threshold, the system
shows `דורשת בדיקת איכות` and the count of tagged suitable leads; it does not
automatically recommend passage on quality alone.

### Round structure

| Setting | Initial value |
|---|---:|
| Maximum simultaneously active ads | 4 |
| Control slots | 2 |
| cold-audience Challenger slots | 1 |
| Remarketing slots | 1 |
| Evaluate Remarketing separately | Yes |

The system compares the structure to Meta's read-only effective statuses and
the manually assigned roles. A mismatch produces a warning, never an account
change.

### Winner and loser recommendation rules

| Setting | Initial value |
|---|---:|
| Minimum CRM deals for winner candidacy | 1 |
| Winner also requires CAC at or below target | Yes |
| No-deal loser gate | Deal-proof spend, initially ₪500 |
| Loser requires maturation period | Yes |

Winner and loser are always phrased as `מועמדת למנצחת` and `מועמדת למפסידה`
until Eli saves an approved manual status.

## Deterministic recommendation engine

The engine accepts normalized evidence plus a validated policy and returns a
closed recommendation code, a testing gate, and an ordered list of reasons.

Recommended labels:

1. `untested` — no spend or delivery;
2. `collecting` — below the first spend gate;
3. `first_gate_pass` — reached the first gate and meets the clear lead pass;
4. `quality_review` — reached the first gate and is in the configured review
   band;
5. `early_stop` — reached the first gate and is at or below the stop maximum;
6. `stability_test` — passed the first gate and is below the stability gate;
7. `continue_to_deal_proof` — at the stability gate and CPL meets the target,
   or a configured suitable-lead override passes;
8. `stop_after_stability` — reached the stability gate without qualifying;
9. `pause_and_mature` — reached the deal-proof spend with no CRM deal and the
   maturation window is still open;
10. `winner_candidate` — enough CRM deals and CAC meets the target;
11. `deal_economics_review` — a CRM deal exists but CAC exceeds the target;
12. `loser_candidate` — no deal after the deal-proof gate and maturation
    period;
13. `insufficient_or_conflicting_data` — exact IDs, dates, spend, leads, or
    attribution are missing or contradictory.

### Rule priority

Apply rules in this order:

1. block on missing or conflicting identity/evidence;
2. if a CRM deal exists, evaluate winner candidacy or deal economics before any
   CPL-based stop;
3. evaluate final spend and maturation;
4. evaluate stability;
5. evaluate the first gate;
6. otherwise collect data.

This priority implements the approved rule that a deal overrides a CPL-only
decision.

### Exact calculations

- `CPL = Meta spend / Meta lead count` for the exact Ad ID and selected window.
- `CAC = Meta spend / CRM deal count` for the exact Ad ID.
- `contribution after ads = deals × configured contribution profit − spend`.
- Delivery days count only dates on which Meta reports spend greater than zero.
- The maturation window starts from the last actual spend date, not ad creation
  date.
- Suitable leads count only leads carrying the configured GHL tag.
- CRM deals remain authoritative over Meta Purchase reporting.

Avoid rounded values when deciding. Round only for display.

## Data acquisition changes

The existing report already reads spend and CRM outcomes, but the decision
engine needs stricter evidence.

- Fetch Meta rows by exact Ad ID with Ad Set ID/name, campaign ID/name,
  effective status, and daily spend.
- Preserve daily rows or aggregate them into first-spend, last-spend, and
  delivery-day counts.
- Aggregate CRM leads, suitable-tagged leads, and deals by exact Ad ID.
- Stop using ad name as the decision identity. Name remains display metadata.
- Detect leads lacking an Ad ID and same-name objects with different IDs.
- Keep the existing Meta reporting-health panel; data-health failures must be
  visible beside recommendations.

Read-only Meta credentials are sufficient. No write permission is required or
desired.

## Persistence and audit

Recommended persistence model:

### Current policy

One validated JSON document in `app_config`, with:

- schema version;
- policy revision;
- all current settings;
- updated timestamp;
- actor identifier when available.

### Policy revision history

An append-only record for every save containing previous and new values. A
recommendation can therefore state which policy revision produced it.

### Per-ad review state

One row per exact Ad ID containing:

- Ad ID and Ad Set ID;
- segment and role;
- approved manual status;
- decision reason;
- changed by and changed at;
- prior status audit.

Do not store live recommendation as the authoritative status. It is derived.
If recommendation snapshots are needed for analysis, store them as append-only
evidence with policy revision and input timestamp.

## Error and unknown-state handling

- Meta unavailable or token expired: keep CRM evidence visible and show that no
  recommendation can be trusted until spend data returns.
- Missing Ad ID: show the row under `לא ניתן להכריע`, never merge by name.
- Same name, several IDs: show separate rows and an identity warning.
- Missing suitable-lead tag configuration: show suitable-lead evidence as
  unavailable; do not infer it.
- CRM/Meta lead mismatch: display both counts and a warning; the CPL calculation
  uses the configured Meta lead definition from `tests.md` (`action_type=lead`).
- Partial date history: do not claim an exact delivery-day or maturation
  decision.
- Invalid settings: reject the save atomically and keep the last valid policy.
- A data or settings failure must never produce a winner/loser recommendation.

## Observability

Use the existing structured logger and route wrappers. Record:

- settings reads and saves;
- policy revision changes and changed keys, without credentials;
- recommendation calculation counts by result code;
- missing identity and attribution warnings;
- Meta fetch failures and staleness;
- manual status changes.

No notification is needed for an ordinary recommendation. Existing monitoring
should alert only when data refresh or recommendation calculation is stale or
failing, not when an ad performs poorly.

## Testing strategy

### Pure unit tests

Table-driven tests cover every recommendation code and boundary:

- ₪99.99 versus ₪100;
- 4, 5, 7, and 8 leads at the first gate;
- strict target-CPL boundary;
- a real deal overriding early-stop logic;
- CAC equal to, below, and above target;
- ₪500 without a deal before and after 14 actual maturation days;
- no invented suitable-lead override while its threshold is unset;
- Prospecting and Remarketing isolation;
- settings validation and normalization;
- same name with different IDs never merged.

### Integration tests

On a throwaway Neon branch:

- settings GET/PUT authentication and persistence;
- revision history and atomic invalid-save rejection;
- per-ad manual status audit;
- exact Ad ID joins across CRM evidence;
- route-gate coverage for every new API.

All Meta calls are stubbed. Tests must never mutate a live ad account.

### UI tests and visual verification

- desktop and 390 px layouts;
- Hebrew RTL and isolated Latin IDs/names;
- loading, empty, stale, error, and conflict states;
- changing a setting recalculates recommendations;
- changing a setting does not alter approved manual statuses;
- the warning explicitly says the feature cannot change Meta;
- widget first, standalone alias second, both rendering the same canonical
  implementation.

## Migration and rollout

1. Add pure settings schema and recommendation engine first.
2. Add persistence and authenticated settings APIs.
3. Add exact-ID and daily Meta evidence without removing the existing report.
4. Add the two sub-tabs and recommendation UI.
5. Seed the approved 2026-09-18 defaults and existing manual statuses from
   `meta-ads.md` only after reviewing exact IDs.
6. Run unit, type, route-gate, integration, build, desktop, and mobile checks.
7. Deploy read-only and compare recommendations with `tests.md` manually.
8. Keep all Meta mutation code absent.

The implementation must preserve the repository rule that `/widget` is the
canonical UI and any standalone/dashboard route imports that exact
implementation.

## Acceptance criteria

- Every live recommendation is tied to an exact Ad ID and a policy revision.
- Every number that can change a recommendation is editable and explained in
  `מודעות → הגדרות בדיקה`.
- Suitable lead means only the configured GHL tag applied by Eli.
- CRM deals, not Meta Purchases, decide deal existence.
- A policy edit immediately changes derived recommendations but never an
  approved manual status.
- Prospecting and Remarketing remain separate.
- Winner and loser remain recommendation-only until a manual internal status
  save.
- Missing or conflicting evidence produces an unknown state, not a guess.
- No code path can activate, pause, edit, or budget a Meta object.
- GHL widget and standalone fallback render the same components.
- Claude Code and Codex can resume from this document and the project
  instructions without chat history.

## Exact next step for the implementing agent

Read `CLAUDE.md`, this design, the two source documents, and the current ads
implementation. Then write a reviewable implementation plan before changing
code. The plan should name files, migrations, tests, rollout checks, and the
exact way the existing production GHL suitable-lead tag maps to the CRM marker.
Do not begin by editing the UI; establish and test the pure recommendation
contract first.
