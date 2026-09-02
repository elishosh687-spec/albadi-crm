# Albadi CRM — Claude Instructions

## Architecture

Next.js app deployed on Vercel. Neon PostgreSQL via Drizzle ORM. WhatsApp messaging via either ManyChat (legacy) or the whatsapp-bridge-node tenant — toggled by `USE_BRIDGE` env (see "Bridge migration" below).

**Deployed URL:** `https://albadi-crm.vercel.app`
**DB:** Neon (see `DATABASE_URL` in `.env`)
**ManyChat account:** see `MANYCHAT_TOKEN` in `.env`
**Bridge tenant:** see `BRIDGE_BASE` + `BRIDGE_TENANT_TOKEN` in `.env`

## Key API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/bot/cron` | Hourly bot — classify leads, save decisions. Called by cloud routine every hour. |
| `POST /api/bot/restart-send` | One-time batch — send re-engagement WhatsApp templates to all stuck leads via ManyChat Flows. |
| `POST /api/bot/new-lead` | Register new lead in DB. Called by ManyChat Flow when new subscriber enters. |

All routes require: `Authorization: Bearer <BOT_SECRET>`

## Cloud Routine

URL: `https://claude.ai/code/routines/trig_01VWAWDtdHXqMMProUCseKbj`
Calls `/api/bot/cron` every hour.

## ManyChat Flows (WhatsApp Templates)

Templates sent via `sendFlow` (not `sendContent` — ManyChat API does not support direct template sending).

| Flow name | flow_ns | Template |
|-----------|---------|---------|
| send_followup_quote_sent | content20260508151701_091472 | albadi_followup_quote_sent |
| send_after_holiday | content20260508152934_109626 | albadi_after_holiday |
| send_price_too_high | content20260508180816_402346 | albadi_price_too_high |
| send_call_request_followup | content20260508152941_860840 | albadi_call_request_followup |
| send_questionnaire_incomplete | content20260508152940_284953 | albadi_questionnaire_incomplete |
| send_last_attempt | content20260508152938_498910 | albadi_last_attempt |

## Leads Table

Leads stored in `leads` table — NOT hardcoded. To add leads manually:
```bash
npx tsx scripts/seed-leads.ts
```

New leads auto-register via ManyChat webhook → `/api/bot/new-lead`. Must configure HTTP Request action in each ManyChat entry Flow.

## Common Commands

```bash
# DB migration after schema change
npx drizzle-kit push

# Seed leads table
npx tsx scripts/seed-leads.ts

# Dry run batch send (no actual send)
npx tsx scripts/restart-send.ts

# Actually send batch
npx tsx scripts/restart-send.ts --confirm
```

## Pipeline stages (post 2026-06-07 funnel rename)

4-active-stage funnel, 6 total + WON/LOST/sides. Internal names match GHL exactly — no translation layer.

| Stage | Hebrew | When | Who sets |
|---|---|---|---|
| `NULL` | בשאלון | first inbound, questionnaire active | bot (`upsertLeadFromBridgeEvent` leaves NULL) |
| `INTAKE` | שאלון + הצעה אוטומטית | questionnaire complete + auto-quote sent; includes the 24h+ silent state | bot (`handleInbound`) |
| `DISCAVERY` | שיחת בירור | customer engaged, salesperson runs discovery / commitment-signal call | bot or salesperson |
| `FACTORY_WAIT` | בדיקת מפעל | non-standard spec, factory check in flight | bot (`routeToFactory`) / Eli (subFlow=awaiting_factory_estimate) |
| `CONSIDERATION` | שוקל הצעה / מו״מ | final quote in customer's hands; haggling lives here | bot (`handleDecisionInbound`) |
| `WON` / `LOST` | terminal | customer confirmed payment / explicit refusal | bot or Eli (LOST requires `loss_reason`) |

Side stages (operator drags manually, bot doesn't transition): `FUTURE_FOLLOW_UP`, `NO_RESPONSE_REENGAGE`.

Source of truth: `V2_PIPELINE_STAGES` in [lib/manychat/stages.ts](lib/manychat/stages.ts). Full transition table: [docs/CUSTOMER-FLOW.md](docs/CUSTOMER-FLOW.md).

**Rename rule.** When renaming or merging a stage: ADD the old name to `LEGACY_STAGE_MAP` (don't remove existing entries). Pattern proven 2026-06-07 — stale DB rows, log entries, and external API payloads keep normalizing cleanly. Run the DB backfill (`UPDATE leads SET pipeline_stage = ...`) AFTER the code lands, never before.

## Known Hardcoded Values (still to fix)

- `TAG_IDS` / `FIELD_IDS` in `lib/manychat/config.ts` — should come from ManyChat API
- `FLOW_NS` in `app/api/bot/restart-send/route.ts` — should move to `.env`
- Business thresholds: `10000` NIS high-value, `5` days no-contact (in `cron/route.ts`)
- Phone numbers in `legacy/daily_calls.py` — security risk, do not commit

## Feishu factory-quote parser — column-shift footgun (READ BEFORE TOUCHING FACTORY PRICING)

The factory quote sheet is a **live shared Feishu sheet**; the factory (or Eli)
can insert/rename columns anytime. `parseFactoryResponseRow` in
[lib/feishu/sheets.ts](lib/feishu/sheets.ts) reads by **fixed integer index**,
so any inserted column silently shifts every factory field one slot right and
corrupts the whole parse. This has bitten us **twice**:

- **2026-05** (a9dfd49): sheet auto-filled column C with a creation date.
- **2026-07-02** (ba1e88f): factory added a `数量` (quantity) formula at column
  **K** mirroring our request qty → unitCost read 5000 (=qty), cbm read 55
  (=height), weight read 0.15 (=cbm), supplier read "11" (=weight). 5 quotes
  flagged in FinalizeModal.

**Diagnostic signature:** FinalizeModal's "נתוני מפעל" panel shows
`⚠️ CBM לא תואם למידות` — cartonCbm is in the hundreds (actually a cm
dimension) while L×W×H imply ~0.0X m³; unitCost in the thousands; supplier is a
bare number. Panel's own `cbmWarn` check (`|cbm−dims|/dims > 0.25`) catches it.

**Current layout (row 5 = header):** `A 联系人 · B 报价单号 · C date · D 图片 ·
E 描述 · F 类型 · G 材质及克重 · H 尺寸 · I logo印刷 · J 表面处理 ·
K(10) 数量 (IGNORED — echoes our qty) · L(11) 人民币价格 unitCost · M(12) 装箱数量
cartonQty · N(13) 长 · O(14) 宽 · P(15) 高 · Q(16) 体积 cbm · R(17) 重量KG ·
S(18) 供应商 · T(19) 备注 remark · U(20) UNLABELED — plate fee
"printing cost: RMB350/COL" lives here` (it shifted T→U with the same K
insertion — `readRow`/`readAllRows` read through **U**, parser scans U then T).

**THREE parsers read this sheet by index — fix ALL of them together, or a
re-import silently re-corrupts what you just fixed:**
1. `parseFactoryResponseRow` — factory numeric fields (L..R) + plate fee (U).
2. `readRow` / `readAllRows` — the fetch ranges (must reach column **U**/20).
3. `parseFactoryRequestRow` — operator/product side (material←G(6), size←H(7),
   printing←I(8), finishing←J(9), quantity←K(10); skip F=类型/type). Used by
   `import-from-feishu`. Fixing only the response parser leaves this one shifted,
   so re-importing a quote rebuilds a SHIFTED productSpec (material=bag-type,
   printing=size-string, finishing=colours, dims/qty=0). Downstream the
   FinalizeModal derives logoColors from `productSpec.printing` via `/(\d+)/`,
   so "H35*..." → "35 colours" and the plate fee explodes (¥350 × 35 = ¥12,250).

**Third occurrence — 2026-08-11, the WRITE side this time.** The factory added a
**`Type` column at F**, but `buildFactoryRow` still emitted 10 values into a
hardcoded `A..J` range. So from F on every field landed one column LEFT of its
header and **Quantity was never written to K at all** — the factory quoted
against a blank/echoed qty (APA1WK7G: 5,000 in the CRM vs 10,000 in the sheet).
A request (SGYNW572) also went missing from the sheet entirely while the DB
recorded `feishu_row_index=58`. Fixed by adding `type` (F, `DEFAULT_FACTORY_TYPE`)
and **deriving the end column from `values.length`** so the next inserted column
can't silently truncate the payload. Symptom to watch for: **column K empty on
new request rows**, or the sheet's qty disagreeing with `product_spec.quantity`.

**Soft-deleted quotes don't own their quotation number (fixed 2026-08-11).**
"Delete the quote, then re-import it from Feishu with the same number" is the
documented recovery path and the screen offers it — but both existence checks in
[import-from-feishu.ts](lib/factory/server/import-from-feishu.ts) queried without
a `deleted_at` filter, so a trashed row blocked its own re-import and the import
silently reported "already exists". If a quote "won't import", first check
`SELECT deleted_at FROM factory_quote_requests WHERE quotation_no = '…'` — and
remember the **סל מיחזור** button on the quotes screen restores it directly.

**Fix recipe when it shifts again:**
1. Dump raw rows incl. row 5 (`readRow` + print each cell with its column
   letter) to see the new layout.
2. Shift the `row[N]` indices in BOTH `parseFactoryResponseRow` AND
   `parseFactoryRequestRow` + the fetch ranges + rewrite the layout comments.
   Commit + **push to prod FIRST** — the refresh crons + widget
   `/api/*/factory/refresh` + re-imports run the OLD parser and re-corrupt DB
   rows the moment anyone touches the tab, so a DB reparse before deploy gets
   overwritten.
3. Reparse the **response** side with a scratch script (model on
   `scripts/_reparse-after-col-shift.ts`): re-locate each row via
   `findRowByQuotationNo` (indices drift too), take fresh numerics **wholesale**
   (do NOT COALESCE — stored numerics are the corrupted ones), keep only
   `platePerColorCny` from stored. Dry-run, then `--go`.
4. For **productSpec** (request side): NEVER blanket-rewrite from Feishu — row
   indices drift and specs get hand-edited, so a blanket re-read corrupts good
   rows. Repair only rows matching the corruption signature (material is a bag
   type not a fabric, or printing matches a size pattern, or qty/dims=0).
5. Verify: 0 rows flagged by a cbm-vs-dims scan; unitCost×qty + total CBM sane;
   logoColors sane (not pulled from a size string).

**Prevention idea (not built):** parse by header-name lookup on row 5 instead
of hardcoded indices → shift-proof. Deferred; the fix is ~10 min when it recurs.

## Meta conversion loop — CRM → Meta (built 2026-08-07)

Reports lead OUTCOMES back to Meta (Conversions API for CRM) so the ad algorithm
optimizes for **quality** leads instead of cheap form-fills. Dataset **"GHL
albadi" `1989217432035920`**; env `META_CAPI_TOKEN` / `META_DATASET_ID` /
`META_GRAPH_VERSION` (+ optional `META_ADS_TOKEN` for spend).

**The whole loop depends on ONE key: the Meta leadgen id.** It is NOT in GHL and
NOT in the FB-import payload — it lives only in the two Meta Instant-Form Google
Sheets. `enrichMetaAttribution` ([lib/sheets/meta-attribution.ts](lib/sheets/meta-attribution.ts))
reads those sheets daily and fills `leads.meta_*` by phone. **Match on phone,
wa_jid AND sid** — a lead's `phone_e164` can be a different number than the form
captured (bit us 2026-08-07: דגא מנשה looked "missing from the CRM" but was
there under a second number).

| Event | Fired by | Value |
|---|---|---|
| `Qualified` | Eli tags the GHL contact **"good lead"** → daily poller | — |
| `QuoteSent` | stage → CONSIDERATION (⚠ see caveat) | — |
| `Purchase` | "סגור עסקה" (single + combined) | `grandTotalExVat` |

**`Qualified` is Eli's judgement — never derive it.** "Was sent a quote" is a
pipeline step (nearly every lead gets one), not quality. He marks a real business
that wanted serious volume and talked straight. Tag aliases: `good lead` /
`ליד טוב` / `ליד_טוב` / `qualified`.

**No GHL Workflow is involved.** `pollGoodLeads` ([lib/meta/good-lead-poll.ts](lib/meta/good-lead-poll.ts))
asks GHL directly (`POST /contacts/search` with a tags filter), maps by
`ghl_contact_id`, sends once, stamps `leads.meta_qualified_sent_at`. Runs inside
the daily `/api/cron/enrich-meta-attribution` (06:00 UTC).

### ⚠️ Where to look when "we can't tell which leads are good"

The loop **fails silently** — nothing errors, it just stops teaching Meta. The
מודעות tab ([app/widget/ads](app/widget/ads/page.tsx)) shows a health strip
([lib/meta/health.ts](lib/meta/health.ts)) — read it first. Then, in order:

1. **Health strip red on "שיוך לידים למודעה"** → the daily cron isn't running, or
   the sheets moved/lost public access. Kick it:
   `POST /api/cron/enrich-meta-attribution` with `Bearer $BOT_SECRET`. It returns
   `{sheets, sheetRows, updated, goodLeads:{tagged,matched,sent}}` — `sheets:0`
   means the Google Sheets aren't readable (sharing or a rotated id in
   `GOOGLE_SHEETS_FB_LEADS_IDS`).
2. **Red on 'תגית "ליד טוב"'** → tagged in GHL but not reported. Usually the GHL
   OAuth token or the same cron. Reset one lead by clearing its
   `meta_qualified_sent_at` and re-running the cron.
3. **Nothing arrives at Meta** → fire one event by hand:
   `POST /api/admin/meta-send-test {sid, eventName, testEventCode?}`. A healthy
   reply is `{"ok":true,"eventsReceived":1,...}`. `meta_400 Invalid parameter`
   = a bad/foreign leadgen id for that lead; an auth error = the token expired
   (regenerate in Events Manager → the dataset → Conversions API).
4. **Re-report history at any time** — `POST /api/admin/meta-backfill-events`
   (`?dry=1` to preview, `?names=a,b` to hand-pick). `event_id` is always
   `<sid>:<eventName>`, so Meta dedups and re-runs can't double count.
5. **Ground truth lives in the DB, not in Meta.** `leads.meta_leadgen_id /
   meta_ad_name / meta_campaign_name / meta_qualified_sent_at` + the deals table
   are the record of who was good and what they were worth. Meta is a consumer;
   if it loses the data we can always re-send from here.

### ⚠️ "Fix it in the GHL workflow" is WRONG advice for this system

Anyone reading Events Manager will eventually be told the fix belongs in a GHL
workflow/automation action. **It does not — no GHL Workflow is involved**, and
all of them are in Draft anyway (see Caveats). Every event is POSTed by
`sendMetaCrmEvent` ([lib/meta/capi.ts](lib/meta/capi.ts)) from this codebase.
Editing GHL changes nothing.

**Is the connection alive right now?** (one command, sends nothing):

```bash
curl -s "$CRM/api/admin/meta-send-test?ping=1" -H "Authorization: Bearer $CALL_TRIGGER_SECRET"
```

`{"ok":true}` = the token is valid. ⚠️ Do NOT "improve" this into a plain
dataset read: our CAPI token can SEND to the dataset but has no permission to
READ its metadata, so `GET /<dataset>?fields=name` returns **"(#100) Missing
Permission"** on a perfectly healthy pipe. `pingMetaDataset` tries the dataset
first and falls back to `/me` on #100; only 190/10/200 mean Meta actually
rejected the credentials. The ads-tab health strip runs this same call, so
"חיבור למטא" is now a live check rather than an env-var check.

**Is the מודעות tab current?** Yes — `export const dynamic = "force-dynamic"`,
so it re-renders server-side on every load. What is NOT live is the *reporting*:
Qualified is sent by the daily 06:00 UTC cron, so a lead tagged an hour ago
correctly shows **ממתין** until it runs.

**To see what we actually send** (Events Manager shows its own view of it, and
its per-event "parameters" panel lists `custom_data`, not the matching keys —
which reads as "only `lead_event_source` is sent"):

```bash
curl -X POST "$CRM/api/admin/meta-send-test?preview=1" -H "Authorization: Bearer $BOT_SECRET" \
  -H 'Content-Type: application/json' -d '{"sid":"<sid>","eventName":"Purchase"}'
```

It returns the exact event plus `matchKeys` — the `user_data` keys attached.
We send `lead_id` (Instant Forms) or `fbc`/`fbp` (website), hashed `ph`/`em`
when the lead has them, and always a hashed `external_id` (the sid).

**Three bugs fixed 2026-08-14, worth recognising if they recur:**
- `pollGoodLeads` filtered on `meta_leadgen_id IS NOT NULL` while the sender
  accepts a leadgen id **OR** an fbclid → every website good lead was tagged and
  never reported. Keep the two rules in sync.
- The health strip compared tagged-count vs **all-time** sent-count (different
  populations), so one unreportable lead rendered as "the cron didn't run". It
  now asks `pollGoodLeads({dry:true})`, which separates pending from
  unreportable-and-why.
- A Purchase whose total resolved to 0 was sent **with no `value`**. Meta still
  counts it and computes ROAS against nothing — and a run of value-less events
  is what its *"all your Purchase events send the same price data"* warning
  actually describes. Value-less Purchases are now refused + logged. The amount
  was never a placeholder: single → `memberDisplayTotalExVat`, combined → the
  frozen combined grand total.

### Website leads — fbclid comes through the CRM, never by sharing credentials

The site dev asked for the **production Neon connection string + a Meta access
token** to "close fbclid + CAPI in one shot" (2026-08-07). Neither is needed, and
that string is full read/write over every customer, message and deal — don't send
it. `/api/leads/website-import` already carries `gclid`/`gbraid`/`utm_*` behind
`WEBSITE_IMPORT_SECRET`, so **`fbclid` + `fbp` just join the same POST**
(→ `leads.meta_fbclid` / `meta_fbp`; an fbclid also sets `leadSource=facebook`).
`sendMetaCrmEvent` attributes on **either** route: a leadgen id (Instant Forms)
or `fbc` built as `fb.1.<createdAtMs>.<fbclid>` plus `fbp` (website). The CRM
stays the only holder of `META_CAPI_TOKEN`. If someone ever does need data
access, cut a read-only Neon user — never the prod string, and never over chat.

### "מודעות" tab — which ad brings money

[app/widget/ads](app/widget/ads/page.tsx) + [lib/analysis/ad-performance.ts](lib/analysis/ad-performance.ts):
per ad — leads · progressed (DISCAVERY+) · % (colour-coded; grey under 5 leads)
· marked-good · won · revenue, filterable 30/90/all. Deterministic, no LLM.

- **Revenue MUST come from `listClosedQuotes().grandTotalExVat`.** The first cut
  summed `final_pricing->>'totalSellingPrice'` and drifted (₪6,793 vs the real
  ₪6,820; one deal read ₪0) — the same trap the "one customer total" section
  above documents.
- Latin ad names need `unicodeBidi:"isolate"` or RTL renders `07_chain_cut` as
  `chain_cut_07`.
- **Cost columns** (עלות / עלות לליד איכותי / רווח) come from
  [lib/meta/ads-insights.ts](lib/meta/ads-insights.ts) — Graph Insights at
  `level=ad`, joined **by `ad_id`, never by name**. They render only when
  `META_ADS_TOKEN` is set, and it must be a **System User token** (a plain user
  token expires in ~1h). `META_AD_ACCOUNT_ID` defaults to `1995170681032178`.

**Caveats worth knowing.** (a) All GHL *Workflows* are in **Draft**, so the
`/api/ghl/stage-changed` webhook likely never fires — the stage-triggered
`Qualified`/`QuoteSent` are effectively dormant; the tag is the real mechanism.
(b) Meta's conversion-leads window is **28 days** from lead creation (not the
7 days generic CAPI articles quote), and the optimized stage must convert at
1–40%. (c) The lead campaigns still optimize for `Maximize number of leads` —
until a NEW campaign is built with **conversion leads** (Meta won't let an
existing ad set switch), Meta only records these events.

## Deploy

Push to `main` → Vercel **usually** auto-deploys via GitHub integration.

**Gotcha (seen 2026-06-07):** the GitHub→Vercel webhook silently doesn't fire sometimes. After pushing, run `vercel ls` and check the top deployment age. If it's older than your last commit, trigger manually:

```bash
~/.local/node/bin/vercel deploy --prod --yes   # or: vercel deploy --prod
```

The CLI deploy uses the linked project from `.vercel/project.json` — no need to specify the project name. Build runs on Vercel (not local).

## Working with Vercel + Neon from the CLI

**Vercel env vars are encrypted by default.** Running `vercel env pull .env` produces a file where sensitive values (`DATABASE_URL`, all `GHL_*`, all `BRIDGE_*`, etc.) come back as empty strings — the CLI cannot decrypt them. The masking is silent: there's no error, the file looks complete.

To actually query the DB or call GHL from local:

- **Neon (DB):** `neonctl` lives at `~/.local/node/bin/neonctl` (npm global, not on `$PATH` by default) and is already authed. Project id: `fragrant-morning-71359670`. Org id: `org-frosty-star-50411125`. One-liner to feed any tsx script the live DATABASE_URL:
  ```bash
  DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/<name>.ts
  ```
  If `neonctl` is missing on a fresh machine: `npm i -g neonctl && neon auth` (OAuth browser flow).
- **GHL API:** the OAuth access tokens live in `ghl_oauth_tokens` table — pull from the DB connection above (`SELECT access_token, location_id FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1`) and hit `services.leadconnectorhq.com` directly.
- **Vercel env writes:** `vercel env add NAME production` reads value from stdin (`echo VALUE | vercel env add ...`). `vercel env rm NAME production --yes` for removal. Production writes require explicit user authorization in this harness — auto-approve is blocked.

## Mobile layer — `.mfit` (READ BEFORE ADDING RESPONSIVE CSS)

Eli works the widget from a **phone browser directly** (not the GHL app), so
every hub tab has to survive ~390px. The tree was built for a desktop iframe:
~95% inline `style={{}}`, and before 2026-08-14 there were **4 `@media` queries
across 90 UI files**.

**All mobile rules live in ONE block at the end of [app/globals.css](app/globals.css),
inside `@media (max-width: 767px)`.** That is deliberate: desktop is unchanged
*by construction*, because a rule that isn't in that block cannot have moved
anything. Verified — at 1440px the shell padding is still exactly
`26px 32px 40px`, `.lux-title` still `32px`, hub margin still `-12px`.

**⚠️ Scope with `.mfit`, NEVER `.gg-theme`.** `.gg-theme` looks like the widget
scope but [app/dashboard/v3/layout.tsx](app/dashboard/v3/layout.tsx) also carries
it, and `middleware.ts` rewrites `/` → `/dashboard/v3` — so a `.gg-theme`-scoped
rule silently restyles the dashboard too. `.mfit` is a marker class that means
"this is a widget screen" and nothing else. It is applied in three places, and
**two of the eleven tabs are NOT under the widget layout**, so they set it
themselves:
- [app/widget/layout.tsx](app/widget/layout.tsx) — covers 9 tabs
- [app/configurator/page.tsx](app/configurator/page.tsx) — מעצב 3D lives outside `app/widget/`
- [components/playground/PlaygroundView.tsx](components/playground/PlaygroundView.tsx) — has no theme class of its own

**The four opt-in hooks** (`!important` only ever lands on a class we invented,
so grepping the name gives the complete blast radius, forever):

| class | effect | when |
|---|---|---|
| `lux-stack-sm` | `grid-template-columns: 1fr` | a hard multi-column grid |
| `lux-scroll-x` | wrapper scrolls sideways | **flat** grids that would scramble if stacked |
| `lux-wrap-sm` | `flex-wrap: wrap` | a row that must stay one line on desktop |
| `lux-tap` | `min-height: 34px` | a small TEXT button (`הסר` was 21×18 and destructive) |
| `size-7` | 28px → 36px | icon buttons (36, not 44 — quote rows carry several) |

Don't replace `lux-tap` with a blanket `.mfit button { min-height }` — the inline
18px payment checkboxes are deliberately small and would stretch into tall thin
boxes (`min-height` beats an inline `height`).

**`flexShrink: 0` + no width cap = clipped, not wrapped.** `LuxTitle`'s `aside`
took its max-content width (a 4-tile KPI row is ~445px) and spilled off the
start edge even after the header wrapped. It carries `maxWidth: 100%` now. Watch
for the same shape anywhere a non-shrinking flex item holds a row of tiles.

**`grid-cols-N` / `1fr` tracks never overflow — they shrink.** Only grids with a
**fixed px track** actually push the page sideways. So a mechanical "add `md:`
everywhere" sweep is churn; fix the fixed-track ones and stack the rest only
where a cell becomes unreadable.

**Stacking is wrong for a flat grid.** [ClosedQuotesView.tsx](components/factory-flow/ClosedQuotesView.tsx)'s
planned↔actual table interleaves header cells with each `CostRow`'s four cells as
**siblings** — collapsing it to `1fr` yields 16 unlabelled rows. It uses
`lux-scroll-x`. Check whether children are flat before reaching for `lux-stack-sm`.

**The two bugs worth knowing:**
1. **iOS zooms the page on focus of any control under 16px** and never zooms
   back — and since tabs are in an iframe, it scales the *top* document, so the
   nav scrolls away with no way back. 163 controls were 11–14px. One rule fixes
   it; don't undo it.
2. **`100vh` ≠ the visible viewport on mobile Safari.** Use `dvh` — the hub
   shell, `LuxShell`, and every modal `max-h` are on `dvh` now.

**The layout padding and the hub's negative margin must stay in sync.** The hub
cancels the widget layout's padding with a negative margin; both are
`clamp(6px, 2vw, 12px)` now. Hardcoding one of them makes the page 4px wider
than the viewport on a phone.

**Verify with the probe, not the eye:** per tab, inside the iframe,
`document.documentElement.scrollWidth <= clientWidth + 1`, and
`[...d.querySelectorAll('input,select,textarea')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).length === 0`.
When listing overflowing elements, **skip anything inside a scrollable
ancestor** (`overflowX auto/scroll` && `scrollWidth > clientWidth`) — otherwise
a deliberately side-scrolling table reports as 28 breaks.

**How to check a DATA screen locally — you CAN (fixed 2026-08-31).** The old
advice here was "you can't, build fixtures instead", because `vercel env pull`
masks `DATABASE_URL` to `""` and this project's Vercel previews cannot build at
all (`DATABASE_URL` is Production-scoped). But `neonctl` is authed on this
machine, so the launch config can resolve the connection string **at launch
time** and nothing secret is written to disk:

```jsonc
// .claude/launch.json — ⚠️ gitignored (.gitignore:15 `.claude/*`), so it is
// per-machine. Recreate this entry if it is missing:
{
  "name": "albadi-crm-data-dev",
  "runtimeExecutable": "sh",
  "runtimeArgs": ["-c", "GHL_WIDGET_TOKEN= DATABASE_URL=\"$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)\" npm run dev -- -p 3002"],
  "port": 3002
}
```

Blank `GHL_WIDGET_TOKEN` takes `verifyWidgetToken`'s dev pass-through branch, so
widget routes open without a token in the URL. **This is the live production
database** — read freely, but anything that writes (a form submit, a delete
button) writes for real. Use `albadi-crm-widget-dev` (port 3001) for pure
layout work where the screen may render empty.

The fixture route is still the right tool when you need a state the real data
does not contain. Two gotchas if you go that way: an `_`-prefixed folder is a
**private** folder and won't route, and a fixture missing one numeric field
throws `undefined.toLocaleString` inside render, which React retries until the
renderer dies — that reads as "the page won't load", not as a bad fixture.

**Footgun while developing:** Turbopack serves a **stale CSS chunk** — edits to
globals.css silently don't appear, and restarting the dev server is not enough.
`rm -rf .next/dev .next/cache` and restart. Two rounds were lost to this.

## Client-bundle import rule (READ BEFORE TOUCHING SHARED CONSTANTS)

`"use client"` components must NEVER import from server-only modules that
throw on missing env vars. The historical offender is
[lib/manychat/config.ts](lib/manychat/config.ts) which starts with:
```ts
if (!process.env.MANYCHAT_TOKEN) throw new Error("MANYCHAT_TOKEN is not set");
```
Server: fine. Client: the bundler inlines the whole module → process.env is
undefined in the browser → module evaluation throws → React unmounts the
tree. Vercel runtime logs show 200 OK (SSR was fine); only DevTools console
shows the actual error.

**Rule:** client-safe constants live in [lib/manychat/stages.ts](lib/manychat/stages.ts) —
`V2_PIPELINE_STAGES`, `V2PipelineStage`, `V2_FLAG_TAG_IDS`, `V2FlagName`,
`V2_FLAG_NAMES`. Add new client-safe constants there, not in config.ts.

**Debug playbook for a "blank/crashed" dashboard page:**
1. DevTools → Console. First uncaught exception is the answer.
2. Vercel runtime logs only cover SSR — they will not show client throws.
3. If the error mentions a server-only env var, the import path is wrong.

Do NOT chase "DOM weight" or "hydration" before reading the console.

## GHL is single source of truth (READ BEFORE TOUCHING ANY SHARED FIELD)

**Decision 2026-05-22:** every field that Eli edits in the GHL UI is owned by
GHL. DB just follows. No two-source-of-truth drift.

**Shared fields (GHL owns, DB mirrors via webhook):**
- `leads.name`, `leads.phone_e164`, `leads.email`
- `lead_tags.tag` (Contact.tags)
- `leads.bot_summary`, `leads.quote_total`, `leads.loss_reason`,
  `leads.bot_paused`, `leads.pipeline_flag` (Contact.customFields)
- `leads.albadi_lead_score` (Contact.customFields — see "Albadi Lead Score" below)
- `leads.notes` (Contact.notes, concat of all)
- `crm_tasks` rows (Contact.tasks, upserted by `ghl_task_id`)
- `leads.pipeline_stage` (Opportunity.pipelineStageId, mapped via `GHL_STAGE_IDS`)
- `opportunities.value_ils` (Opportunity.monetaryValue)
- `opportunities.won_at` / `lost_at` (Opportunity.status)

**DB-only fields (GHL never touches):**
- `leads.q_state` (questionnaire FSM), `leads.quote_alt`, `leads.factory_spec_draft`
- `messages`, `bot_quotes`, `bot_drafts`, `bot_decision_log`
- `bot_config`, `app_config`, `factory_quote_requests`, `bridge_events`
- `crm_sla_timers`, `lead_score_snapshots`, `source_touches`, `ghl_lead_tasks`

**Webhook map (GHL → DB):**
| Endpoint | Trigger | Scope |
|---|---|---|
| `/api/ghl/stage-changed` | Opportunity Stage Changed | `leads.pipeline_stage` only |
| `/api/integrations/inbound/ghl-tag` | Contact Tag Added/Removed | `lead_tags` delta |
| `/api/integrations/inbound/ghl-custom-field` | Custom Field Changed | `bot_paused`, `follow_up_date` only |
| `/api/ghl/resync` | Contact Changed + Opportunity Changed | **catch-all full pull** — name, phone, email, tags, customFields, notes, tasks, opps |

**resync now CREATES, not just updates (2026-07-29).** `resyncContact`
([lib/ghl/resync-helper.ts](lib/ghl/resync-helper.ts)) used to bail with
`no_lead_matched` when a GHL contact had no DB lead — which meant a contact
created **manually in the GHL UI** (`attributionSource` = CRM UI / manual),
the one ingestion path that never makes a DB row, stayed invisible to the bot
and every CRM screen forever. It now INSERTS the lead (synthetic sid:
`<phone>@s.whatsapp.net`, or `ghl:<contactId>` when phoneless) and fills the
rest as usual. The native `ContactCreate` app-webhook already fires, so manual
GHL leads now land in DB automatically — no screen, no cron. Only truly-empty
contacts (no phone AND no name) are still skipped. So the old "resync only
updates, never creates" assumption (still echoed in some scratch scripts /
memories) is **no longer true**.

**Rule:** if you add a new shared field or webhook, update the matrix in
[docs/ARCHITECTURE.md §3b](docs/ARCHITECTURE.md). If GHL doesn't have a
trigger for what you need, prefer extending the resync endpoint over
making another narrow webhook.

**Loop guard:** when the bot writes a shared field to DB, `syncLeadToGHL`
pushes to GHL. The resync webhook will then fire and re-read the same
value — but the merge is idempotent (`COALESCE` semantics for nullable
fields, stage equality check for pipeline_stage), so no infinite loop.

## Bridge messaging (READ BEFORE TOUCHING MESSAGING)

**Active backend = GreenAPI (confirmed 2026-06-08).** WhatsApp send/receive
runs through GreenAPI, not the bridge tenant directly. ManyChat is fully
retired (only historical backfill scripts touch its API). The layering is two
nested flags:
- `USE_BRIDGE=1` routes `@/lib/messaging` → `lib/bridge/client.ts` (vs the dead
  ManyChat path).
- `USE_GREEN_API=1` then makes `sendBridgeMessage` delegate to
  `sendGreenMessage` (`lib/greenapi/client.ts`). Inbound arrives at
  [app/api/greenapi/webhook/route.ts](app/api/greenapi/webhook/route.ts).
The `whatsapp-bridge-node` tenant code still exists but is dormant while
`USE_GREEN_API=1`. Tags, custom fields, and pipeline state live in the DB.

**⚠️ Two JID namespaces — the #1 messaging footgun.** GreenAPI uses
`<phone>@c.us`; FB-import leads ([api/leads/facebook-import](app/api/leads/facebook-import/route.ts))
are stored under `<phone>@s.whatsapp.net`; the bridge also uses
`@s.whatsapp.net` + `@lid`. So a lead's `manychat_sub_id` (sid) and the Green
`chatId` for the SAME person often differ only by suffix. Any code that maps a
chatId back to a lead MUST canonicalise first — use
`resolveLeadSidForChatId` (green client) on the way in, and `loadLead`
(`integrations/ghl/sync.ts`) has a phone-digit fallback as the safety net.
Bug fixed 2026-06-08: the GHL outbound mirror passed the raw `@c.us` chatId →
`loadLead` missed → every bot/eli reply was dropped from the GHL Inbox
(`ghl_mirror.skip reason=no_lead`) while inbound (already canonicalised)
showed fine. Symptom: GHL thread shows only the customer side.

**Feature flag:** `USE_BRIDGE=1` is permanent. Setting it to `0` would route
through `lib/manychat/client.ts` which is deprecated and unmaintained.

**Import rule:** all server-side code MUST import messaging helpers from `@/lib/messaging`, NOT from `@/lib/manychat/client` or `@/lib/bridge/client` directly. The adapter at [lib/messaging/index.ts](lib/messaging/index.ts) re-exports the active backend.

**State ownership when USE_BRIDGE=1:**
- `leads` row holds name, phone (E.164), wa_jid, and every custom field (`pipeline_stage`, `next_action`, `bot_summary`, `notes`, `quote_total`, etc.). DB is authoritative.
- `lead_tags(manychat_sub_id, tag)` holds tag membership by NAME (Hebrew keys from `TAG_IDS` / `V2_FLAG_TAG_IDS`). Numeric ids only live in code maps for backward compat with the legacy `addTag(id, tagId)` signature.
- `bridge_events(evt_id UNIQUE)` audits every signed webhook envelope and dedupes retries.
- `messages.wa_message_id` carries the bridge-side id for dedupe on inbound webhook retries.

**Identity:** for bridge-origin leads we store the chat JID (e.g. `972…@s.whatsapp.net`) in `leads.manychat_sub_id`. ManyChat-origin leads keep their numeric subscriber id. The two namespaces never collide (JIDs contain `@`).

**Webhook endpoint:** [app/api/bridge/webhook/route.ts](app/api/bridge/webhook/route.ts) verifies HMAC-SHA256 over `t.rawBody` against `BRIDGE_WEBHOOK_SECRET`, rejects >5min replay window, logs to `bridge_events`, and routes `message.received`/`message.sent` through `lib/bridge/client.ts`. Other event types (`delivered`/`read`/`failed`/`tenant.*`) are audit-logged only.

**Templates are out.** The bridge only sends free-form text/media inside the
WA 24-hour customer-service window. Outside it, WhatsApp blocks the send.
There is currently no template fallback — `scripts/restart-send.ts` is
historical and not in use.

**Contact enrichment:** the bridge `message.received` event does NOT carry
name/phone for `@lid` JIDs. `upsertLeadFromBridgeEvent` calls
`GET /v1/contacts/<jid>` and merges via `COALESCE` so manual edits are
preserved. `scripts/backfill-contact-info.ts` re-enriches in bulk.

## Dashboard v3 (the only dashboard)

`/dashboard/v3` is the live supervisor console. v2 was removed on
2026-05-14; the bare `/dashboard` URL redirects to v3. See
[app/dashboard/README.md](app/dashboard/README.md) for structure and
[app/dashboard/v3/README.md](app/dashboard/v3/README.md) for conventions.

**Feature flag:** `ENABLE_DRAFT_QUEUE=1` is on in prod. Money-related
escalations (`negotiating` / `reject` / `spec_change`) generate a draft
reply via `generateAndQueueDraft` (LLM-tuned for money moments) and store
it in `bot_drafts` for Eli to approve from `/dashboard/v3/drafts`.

**Data model:**
- `bot_drafts` — pending/approved/rejected/sent/failed. Always sent via
  `lib/drafts/approveDraft` (calls `sendBridgeMessage` under the hood).
- `messages.sender` — `'lead' | 'bot' | 'eli'`. `sendBridgeMessage`
  pre-inserts with `sender='bot'`; `sendManualReply` passes `'eli'`. The
  webhook handles races by upserting text+sender on existing rows so the
  late copy with real content wins.

**API surface (all auth `Bearer BOT_SECRET`):**
- `GET /api/drafts/pending`
- `POST /api/drafts/:id/approve` — `{ edited_text? }`
- `POST /api/drafts/:id/reject` — `{ reason? }`
- `POST /api/leads/:id/override` — `{ pipeline_stage?, flags?, notes?, bot_paused?, pipeline_flag? }`

**Server actions:** `app/actions/v2.ts` (filename historical) — used
directly by v3 client components. Includes `setLeadStage`,
`updateLeadNotes`, `setBotPaused`, `snoozeLead`, `sendManualReply`,
`suggestRepliesAction`, `approveDraftAction`, `rejectDraftAction`,
`updateLeadContactAction`, `saveBotConfigAction`.

**Test scripts:**
- `npx tsx scripts/seed-draft.ts [sub_id] [text]` — inject a pending draft.
- `BOT_SECRET=... npx tsx scripts/test-drafts-api.ts` — API smoke test.

**Adding a new write surface:** prefer server actions in
`app/actions/v2.ts`. Add a REST endpoint only when external tooling needs
HTTP access. If it sends WhatsApp, route through `sendBridgeMessage` so
the outbound row gets sender attribution automatically.

## FB Lead Ads form pipeline (Sheet → Apps Script → CRM)

Replaces the old Google Apps Script → ManyChat path. Three independent layers around a single Google Sheet; safe to re-run end-to-end.

**Sheet** — Meta Lead Ads native CRM connector writes rows directly. **One sheet per form**: Meta writes each form's answers starting at column 12 in *that form's* field order, so two forms sharing a sheet put answers under each other's headers. Live sheet since 18/08/2026: `18RsMyyHGjlUW98xpHROmAn6lxlAW1bTAXhOoEVa9OqQ` ("albadi 18.8.26", form `2538189129956046`); `1AnswoeBAFV-…` ("Albadi leads v2") holds the 183 leads up to that date. Every known sheet id lives in `DEFAULT_SHEET_IDS` ([lib/sheets/meta-attribution.ts](lib/sheets/meta-attribution.ts)) and both the attribution pass and the gap panel read the whole list — the env var *adds*, it does not replace. **Each sheet must be "Anyone with link → Viewer"** or that sheet is silently skipped.

⚠️ **Columns are resolved by header name** ([lib/sheets/fb-form-columns.ts](lib/sheets/fb-form-columns.ts)), not position — the table below is the *historical* layout kept as fallback. In the 18/08 sheet the same fields sit at 17/18/16. Do not reintroduce fixed indices.

| idx | column | written by |
|-----|--------|------------|
| 0–11 | `id`, `created_time`, ad/adset/campaign/form metadata, `is_organic`, `platform` | Meta |
| 12 | `שם_מלא` | Meta |
| 13 | `phone` (with `p:` prefix) | Meta |
| 14–16 | `דוא"ל`, `שם_החברה`, `lead_status` | Meta |
| 18 | `SENT` marker (gates re-processing) | Apps Script |
| 19 | status string (`sent` / `tagged_only` / `BAD_PHONE: …` / `lead_created_send_failed` / `http_*` / `exception_*`) | Apps Script |
| 20 | returned `sid` | Apps Script |

**Apps Script** lives in the sheet itself (time-driven trigger every 5 minutes; not in this repo). Function `onNewLead` iterates rows, skips rows already marked `SENT` and rows whose phone contains `"test lead"`, normalizes via `fixPhone` (handles `p:` prefix, `0…` → `+972…` Israeli local, bare digits → country-coded), POSTs `{phone, fullName}` to `/api/leads/facebook-import` with `Bearer FB_IMPORT_SECRET`. BAD_PHONE rows write status but NOT SENT — eligible for retry after manual fix.

**CRM endpoint** [app/api/leads/facebook-import/route.ts](app/api/leads/facebook-import/route.ts):
- Phone stored in DB **without `+`** (`leads.phoneE164 = "972525755705"`). The endpoint uses `digitsOnly()` for both inbound normalization and dedupe lookup — DB and endpoint agree on the no-`+` form.
- Dedupe by `phoneE164 OR waJid`. Existing lead → adds `ליד_חדש` tag (idempotent), sets `leadSource="facebook"` if null, returns `tagged_only`. **Does NOT re-send OPENING.**
- New lead → inserts with `source="facebook_import"` (pipeline marker, distinguishes from `greenapi_webhook`) and `leadSource="facebook"` (attribution), sends OPENING + kicks off the questionnaire, returns `sent`.

**Dashboard consumer** [lib/sheets/lead-gaps.ts](lib/sheets/lead-gaps.ts):
- Env var `GOOGLE_SHEETS_FB_LEADS_ID`. Fetches `https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=0` — no auth, soft-fails to empty snapshot on any error.
- Column constants `COL_NAME=12, COL_PHONE=13, COL_SENT=18, COL_LAST_STATUS=19, COL_SID=20` match the Apps Script writes exactly. Classification: SENT → not a gap; BAD_PHONE prefix → bad_phone; `lead_created_send_failed` → send_failed; `http_*`/`exception_*` → other_error; else → pending.
- Consumed by [app/dashboard/v3/leads/page.tsx](app/dashboard/v3/leads/page.tsx) ("פערי טופס" pill) and [app/api/bot/followups/route.ts](app/api/bot/followups/route.ts) (cron DMs Eli about stuck rows).

**Rotating the sheet:** add the id to `DEFAULT_SHEET_IDS`, share the sheet "Anyone with link → Viewer", and copy the Apps Script into it (the script lives in the sheet, not in this repo). No env change and no redeploy needed — which matters, because Vercel deploys have been blocked since 17/08. Column layout may differ freely; resolution is by header.

## GHL-gap audit (leads missing from GHL)

For "לידים שנופלים בין הכיסאות" — active leads with WhatsApp activity (msgs / jid / phone) and `ghl_contact_id IS NULL`. Two ways to run, both already in the repo:

- **HTTP** (recommended): `GET /api/admin/audit-ghl-gap` with `Authorization: Bearer $BOT_SECRET`. Query params: `?limit=N` (1..500, default 100), `?onlyBotTouched=1`. Returns `{summary, leads}`. Source: [app/api/admin/audit-ghl-gap/route.ts](app/api/admin/audit-ghl-gap/route.ts).
- **CLI**: [scripts/audit-ghl-gap.ts](scripts/audit-ghl-gap.ts). Run with the neonctl one-liner above.

## Deleting a lead end-to-end (test cleanup pattern)

Sixteen tables reference a lead by `manychat_sub_id` (or `lead_sid` in `bot_quotes` / `ghl_lead_tasks`). None have FK constraints, so deletes never cascade or block. For a clean test reset:

1. **Delete the GHL contact via UI first** — otherwise the next GHL resync recreates the DB row from GHL state.
2. Run a scoped script that deletes from each table where the sid matches. The full table list is in `scripts/_purge-eli-lead.ts` (scratch, underscore-prefixed). Order doesn't matter — no FKs.
3. Verify with a phone/sid lookup against `leads`.

The bot-side effect: after a fresh insert via the FB-import path, the new lead has `ghl_contact_id=NULL` until the first inbound triggers a GHL sync.

## GHL call recording analysis pipeline

Every completed GHL call gets transcribed (Whisper), analyzed for sales signals (GPT), and posted back to the contact as a structured Hebrew note. Polls every 5 min, no GHL webhook needed.

**Data model:** [drizzle/schema.ts](drizzle/schema.ts) → `call_recording_imports`. One row per recording, keyed on `ghl_message_id` UNIQUE. State machine in `status` column: `pending` → `transcribing` → `analyzing` → `posted` (terminal happy path); branch terminals: `failed` (>= 3 attempts), `skipped_oversize` (>25MB), `skipped_voicemail`. `(status, attempts)` composite index for cron query efficiency.

**Pipeline stages**, each runs independently per cron tick — partial failures in one stage don't block others. Per-row gating in [app/api/bot/process-recordings/route.ts](app/api/bot/process-recordings/route.ts):

| Stage | Selector | Tools used |
|-------|----------|------------|
| 1 — discover | poll GHL `messages/search?type=TYPE_CALL&startAfterDate=<cursor−30min>`, filter `meta.call.status=='completed'` AND `dateAdded > 60s ago` | `searchCallMessages` in `integrations/ghl/client.ts` |
| 2 — transcribe | `transcript IS NULL AND status NOT IN (failed/skipped_*)` | `downloadRecording` + `transcribeAudio` ([lib/transcription/whisper.ts](lib/transcription/whisper.ts)) |
| 3 — analyze | `transcribed_at IS NOT NULL AND analyzed_at IS NULL` | `analyzeCall` ([lib/autoresponder/call-analysis.ts](lib/autoresponder/call-analysis.ts)) |
| 4 — post back | `analyzed_at IS NOT NULL AND posted_back_at IS NULL` | `listContactNotes` (dedupe via marker) + `addContactNote` |

**Cursor:** `app_config` key `"call_recordings.last_polled_at"` (JSON `{iso}`). First run looks back 24h. Each tick rewinds by 30min as a belt-and-suspenders overlap; unique `ghl_message_id` constraint handles dedupe.

**GHL endpoint quirks (validated empirically 2026-06):**
- `GET /conversations/messages/search` rejects `?type=TYPE_CALL` with 422 ("type must be a valid enum value"). It doesn't accept type-based filtering at all on this endpoint.
- Correct path is two-stage: `GET /conversations/search?lastMessageType=TYPE_CALL` → enumerate conversation ids; then `GET /conversations/{id}/messages` per conversation and filter to call-type messages (`type === "TYPE_CALL"` or `meta.call` present).
- `/conversations/{id}/messages` nests the array oddly: response shape is `{messages: {messages: [...], nextPage, lastMessageId}}`.
- `startAfterDate` on `/conversations/search` is a **pagination cursor** (search_after on last_message_date), not a date filter. Polling-style "give me everything since X" doesn't work — we just take the newest 20 every tick and rely on the unique constraint.
- Recording download: `GET /conversations/messages/{messageId}/locations/{locationId}/recording` returns the binary directly (`audio/x-wav` or `audio/mpeg`), not a signed URL.

**Note format and idempotency.** Stage 4 posts a Hebrew-structured note whose first line is the stable marker `[CALL-ANALYSIS v1] msg=<ghl_message_id>`. Before posting, stage 4 lists existing notes via `listContactNotes` and skips if the marker is already present — survives crashes between API call and DB write.

**Retry policy.** Per-row `attempts` increments on every failure; row goes to `status='failed'` after `MAX_ATTEMPTS=3` and is excluded from all subsequent stages until manually reset. `last_error` / `last_error_at` capture the most recent failure for triage.

**Limits and caps.** Hard cap of 5 recordings per tick per stage (keeps the cron under `maxDuration=300s` and well within Whisper's 50 RPM tier). Whisper rejects >25MB audio — oversized rows are immediately moved to `skipped_oversize` (Phase B will add ffmpeg downcompression before this cap).

**Env vars (Vercel prod):**
- `OPENAI_API_KEY` — required (shared with autoresponder)
- `OPENAI_TRANSCRIBE_MODEL` — optional, defaults `whisper-1`
- `OPENAI_ANALYSIS_MODEL` — optional, defaults to `OPENAI_MODEL` (`gpt-4o-mini`)
- `BOT_SECRET` — auth (shared with other crons)
- All `GHL_*` — already configured

**Trigger (2026-07-08 — CHANGED, read this).** `process-recordings` is triggered
by a **GitHub Actions cron** (`.github/workflows/process-recordings.yml`,
`*/5 * * * *`) that POSTs the prod endpoint with the `CALL_TRIGGER_SECRET` repo
Actions secret (which `authorized()` accepts alongside BOT_SECRET). NOT a
vercel.json cron — **the Vercel plan only runs crons once/day, so a `*/5` vercel
cron never fires** (verified 2026-07-08: cursor didn't advance in 8 min). It was
ORIGINALLY an external claude.ai routine that **silently died on 2026-07-06**
(likely the Vercel spend-pause → 402) and stalled the WHOLE pipeline for 2 days —
no transcription/analysis/notes AND no "Last Call Date" stamps. If calls stop
processing again, check: (1) is the GitHub Action running/enabled (Actions tab —
GitHub disables scheduled workflows after 60d of repo inactivity)? (2) is the
deployment spend-paused (curl the prod URL → 402)? (3) has the
`call_recordings.last_polled_at` cursor in `app_config` gone stale? Manual kick:
`gh workflow run process-recordings.yml`, or POST the endpoint with
`CALL_TRIGGER_SECRET` (retrievable via `vercel env pull` — it's non-sensitive).

**GHL calls are POLLED, not pushed.** Unlike WhatsApp (bridge webhook, real-time),
GHL never webhooks us a call — stage 1 polls `searchCallMessages` every tick. So
if the cron isn't running, calls are never ingested AT ALL (the field/notes gap
is an ingestion gap, unrelated to transcription). Manual catch-up: a scratch
script calling `searchCallMessages({limit:100})` + inserting rows
(completed→`pending`, non-answered→`no_answer`), dedupes on `ghl_message_id`.

**"Last Call Date" GHL field (2026-07-08).** Calls-only, sortable column in GHL
Contacts (GHL's native "Last activity" mixes calls + WhatsApp/SMS). GHL custom
field `GHL_FIELD_LAST_CALL_AT` (id `VGXhVbDq8sfjmxvvOo0U`, DATE). Stamped to
`MAX(call_started_at)` over ALL a contact's calls — answered AND unanswered
(stage 1 now ingests non-answered calls as terminal `no_answer` rows; `stampLastCall`
runs in stage 1 on new calls + stage 4 on post-back). Backfilled via
`scripts/backfill-last-call-field.ts`. To add the column: GHL Contacts → Manage
fields → "Last Call Date".

**Dry-run before going live.** `npx tsx scripts/_test-call-pipeline.ts` (with `DATABASE_URL` set) runs all four stages inline against a real recent call and prints the note body that WOULD be posted — DB is touched (cursor stays untouched), but `addContactNote` is NOT called. Use this to validate Hebrew analysis quality before flipping the cron on.

**Upgrade path for analysis quality.** If `gpt-4o-mini` underperforms on spoken Hebrew nuance, swap the LLM in `lib/autoresponder/call-analysis.ts` to a Claude-Sonnet wrapper (~30 line change behind the same `analyzeCall` signature). Don't pre-optimize — see real outputs first.

## ElevenLabs voice agent (Twilio telephony → GHL)

A Conversational-AI phone agent that calls/answers leads in Hebrew, plus an
**additive sibling** of the GHL call-recording pipeline above that mirrors each
agent call into GHL as a note + playable recording. Built 2026-06-09. It does
**not** touch `process-recordings` (the GHL-native dialer path) — both run side
by side, keyed on different tables.

**The agent.** "Marketing Lead Capture Agent", `agent_id =
agent_2101ktmrrw08ef29qty75p1qqpc3`. Hebrew system prompt + first message
(outbound "you left details → we call you back" flow), grounded in the real
questionnaire (`lib/autoresponder/questionnaire.ts`) and 52 analyzed past
calls. `platform_settings.summary_language = "he"` so ElevenLabs' own summary
is Hebrew (the note's fallback when `analyzeCall` returns null). Agent LLM is
`glm-45-air` (small/cheap — upgrade for better Hebrew nuance); analysis LLM is
`gemini-2.5-flash`. Edit the agent via `PATCH /v1/convai/agents/{id}` (do NOT
send `conversation_config.agent.language` — it 400s against the TTS model;
language is already `he`).

**Telephony.** Twilio number **+972 3-382-2538** (`+97233822538`,
`phone_number_id = phnum_6701ktmwg1dcebr9w659vms6dc6y`), imported via
`POST /v1/convai/phone-numbers` (Twilio SID+token) and assigned to the agent —
`supports_inbound` + `supports_outbound`. ElevenLabs auto-sets the Twilio
voice webhook to `api.elevenlabs.io/twilio/inbound_call`. A GHL number can NOT
double as the agent's line (one voice webhook per number; GHL owns its
numbers' Twilio). Outbound calls: `POST /v1/convai/twilio/outbound-call`
`{agent_id, agent_phone_number_id, to_number}` — currently manual; auto-dial
of new leads is NOT built yet.

**Sync pipeline** — [app/api/elevenlabs/sync-calls/route.ts](app/api/elevenlabs/sync-calls/route.ts), 4 stages, per-row gated, cap 5/stage/tick:

| Stage | Selector | Action |
|-------|----------|--------|
| 1 discover | list conversations since cursor | insert rows (`conversation_id` UNIQUE) |
| 2 enrich | `transcript IS NULL` | pull transcript + `metadata.phone_call.external_number` + ElevenLabs summary |
| 3 analyze | `enriched_at NOT NULL AND analyzed_at IS NULL` | `analyzeCall` (Hebrew, reused) |
| 4 post | `analyzed_at NOT NULL AND posted_back_at IS NULL` | resolve GHL contact by phone → note + recording attachment |

**Data model:** `elevenlabs_call_imports` ([drizzle/schema.ts](drizzle/schema.ts)),
`conversation_id` UNIQUE. Status: `pending → enriched → analyzed → posted`;
branch terminals `skipped_no_contact` (web/widget call, no phone to bind),
`skipped_empty`, `failed` (>= 3 attempts). Cursor: `app_config` key
`elevenlabs.last_polled_unix`.

**Recording attachment.** ElevenLabs audio needs the `xi-api-key`, but GHL
fetches attachment URLs unauthenticated — so
[app/api/elevenlabs/recording/[id]/route.ts](app/api/elevenlabs/recording/[id]/route.ts)
proxies it as `<conv_id>.mp3` (injects the key). Stage 4 uploads that proxy
URL via `uploadMediaFromUrl` and attaches it with `postOutboundMessage`
(type `Custom`, the same conversation provider as the WhatsApp mirror) so it
renders as a playable bubble in the GHL contact.

**Idempotency:** stage 4 checks existing notes for the marker
`[CALL-ANALYSIS-11L v1] conv=<id>` before posting (survives crashes); the
`conversation_id` UNIQUE constraint dedupes discovery.

**Trigger.** No dedicated routine yet (claude.ai scheduler was down 2026-06-09).
Instead **piggybacked on the existing `process-recordings` 5-min Cloud
Routine** — its POST handler ends with a non-fatal internal `fetch` to
`/api/elevenlabs/sync-calls`. To decouple later: remove that block and register
a dedicated routine hitting `POST /api/elevenlabs/sync-calls` with
`Authorization: Bearer $BOT_SECRET`.

**Env vars (Vercel prod):** `ELEVENLABS_API_KEY` (required), `ELEVENLABS_AGENT_ID`
(optional — scopes discovery to one agent). Auth on the cron: `BOT_SECRET` /
`CALL_TRIGGER_SECRET` (shared with other crons).

**Manual verify:** [scripts/_verify-11l-e2e.ts](scripts/_verify-11l-e2e.ts) runs
the full pipeline against one conversation with inline env (`ELEVENLABS_API_KEY`
+ `GHL_LOCATION_ID` + `GHL_CONVERSATION_PROVIDER_ID` + `DATABASE_URL`) — it
posts a real note + recording, so use a disposable contact. Analysis (OpenAI)
only runs where `OPENAI_API_KEY` is present (prod), so a local run falls back to
the Hebrew ElevenLabs summary.

**Footguns.** (1) Web/widget calls have no phone → `skipped_no_contact` (can't
bind a GHL contact) — expected, only telephony calls sync. (2) Editing the
agent with `language` in the payload 400s (see above). (3) The recording proxy
needs `ELEVENLABS_API_KEY` in the **prod** runtime, else it 502s and the audio
attach silently fails (note still posts).

## Pipeline audit — "יישור הלידים" (built 2026-07-01)

Two panels on the ניתוח tab (widget), both auto-load on mount. Deterministic
SQL + LLM verdict, no separate LLM for the audit itself.

**"נפלו בין הכיסאות"** — every lead in an ACTIVE stage (NULL / INTAKE /
DISCAVERY / FACTORY_WAIT / CONSIDERATION — anything except WON/LOST) with
zero open `crm_tasks`. Eli opens each in GHL, adds a task by hand.

**⚠️ Duplicate opportunities — newest wins (2026-07-28).** A GHL contact often
holds SEVERAL opps in the albadi pipeline. `reconcileStagesFromGhl`
([reconcile-stages.ts](lib/analysis/reconcile-stages.ts)) picks the contact's
**most-recently-updated** opp (linked `ghl_opportunity_id` is only the fallback).
The earlier "linked opp always wins" rule left a lead stuck ACTIVE whenever Eli
dragged a *different* card of that contact to "לא נסגר" — the stale linked
duplicate kept winning and the lead never left this panel. Also note GHL dragging
to the "לא נסגר" column does NOT set `status:'lost'` (status stays `open`), so
LOST detection depends on `GHL_STAGE_LOST` being mapped — it is, in prod.
Reconcile failures are now logged loudly (`ok:false` used to print nothing, so a
drifted DB looked freshly synced).

**"שלב לא תואם"** — leads whose `pipeline_stage` lags behind the [lead-analyzer]
verdict, gated on `commitment_scorecard.score_1_5`. Rules in
[lib/analysis/pipeline-audit.ts](lib/analysis/pipeline-audit.ts):
- **DISCAVERY**: call analyzed + commitment ≥ 2
- **FACTORY_WAIT**: `factory_quote_requests` row exists + not cold
- **CONSIDERATION**: `sent_to_customer_at` set + commitment ≥ 3 OR blocker
  ∈ {price, payment_terms, moq, spec_open}
- Cold verdict (insufficient_data / commitment ≤ 1) → no suggestion

Per-row ✓ אשר / ✗ דחה + a dropdown to override to any of the 6 canonical
stages (קליטה / אפיון / מחכה למפעל / שוקל / משא ומתן / נסגר / אבוד). Apply
goes through `setLeadStage` — DB + GHL + `ensureAutoTaskForStage`.

**Cron ([/api/cron/analyze-active-leads](app/api/cron/analyze-active-leads/route.ts))**:
daily 03:30 UTC (06:30 IL). Runs `analyzeLead` on every active lead with a
stale/missing verdict (cap 40/tick, concurrency 3), then a `sweepOrphanTasks`
pass that finds every open `crm_tasks` row without an assignedTo, sets it
to Itay in DB, and PATCHes GHL for rows that carry a `ghl_task_id`.

## The bot layer — who says what (rebuilt 2026-08-16/17)

**Read [bot design/09-bot-map.md](bot design/09-bot-map.md) first**, and the
LIVE map at מגרש בדיקות → "🗺 מפת הבוט", which reads the real settings and job
cursors on every open. A written map rots; that tab cannot.

**The division of labour, which is now the organising principle:**

| Job | Owner |
|---|---|
| Questionnaire + all price maths | **Code**, deterministic. Never move this. |
| WHEN to speak, to WHOM, how often | **Code** — cadence, attempt cap, quiet hours, Sabbath, `bot_paused` |
| WHAT is said | **The setter** (`lib/setter/`) — follow-ups, live replies, and the phrasing of the 14 state-change moments |
| Whether the transition happens | **Code** — the setter only supplies words |

"Code decides and executes, the sales brain talks." When adding a customer-facing
message, ask which half it belongs to — a sentence fused to a state change
(accept → ask for logo) splits: code does the transition, `phraseStateReply`
writes the sentence, and `mustMention` guarantees the operative ask survives.

**⚠️ Every LLM path degrades to a fixed fallback, by design.** Follow-ups fall
back to the canned template, `phraseStateReply` to the canned sentence,
transcription from ElevenLabs to OpenAI. This is not defensive padding: on
2026-08-17 the OpenAI account ran out of credits and every AI path went dead
for a full day — customers still got their follow-ups, in the old wording,
because the fallback held. **Never add an LLM send path without one.**

**⚠️ Failures here are SILENT.** Nothing errors; the system just gets stupider.
`setter_decisions.draft_text IS NULL` across a window means the LLM is dead —
that is how the credit exhaustion was found, and how the `temperature` bug was
found before it. When "the bot sounds dumb", check that column first.
`npx tsx scripts/_check-ai-health.ts` (with the neonctl `DATABASE_URL`) prints
all five jobs at once, so a partial recovery is visible rather than averaged.

**⚠️ Topping the credits back up does NOT self-heal the queue.** Recordings that
failed during the outage reached `attempts=3` and went terminal `failed`, which
excludes them from every stage forever. Re-queue only those —
`scripts/_reset-credit-failures.ts` matches on `last_error ILIKE '%no credits
remaining%'` and leaves genuine failures ("returned no text", timeouts) alone —
then POST `/api/bot/process-recordings` with `CALL_TRIGGER_SECRET`. Verified
2026-08-17: 8 rows re-queued, all 8 transcribed → analyzed → posted.

### ⚠️ Never put a concrete value in a prompt as an "example"

The appointment skill carried *"(למשל 'היום ב-17:00 או מחר ב-11:00')"*. The
generator copied it verbatim: 30/08–01/09/2026, **20 of 26** messages naming an
hour named exactly those two, to 18 customers, and **6 offered "היום ב-17:00"
after 17:00 had passed** (one at 19:20). An example is indistinguishable from
an instruction, and a value that must also be TRUE RIGHT NOW is doubly wrong —
the model has no clock.

Hours now come from [lib/setter/slots.ts](lib/setter/slots.ts)
(`proposeCallSlots`): real Israel working hours, never within 90 minutes, never
on a Sabbath or holiday, one slot per day over consecutive working days, and
**shifted per lead** so two customers don't hear the same slot. The generator
gets the exact strings, sees them ONLY when the goal is `book_call`/`revive`,
and `validateMessage` rejects any hour — **and any day** — that wasn't offered.
Validating the hour alone is not enough: "היום ב-17:00" at 19:20 uses an hour
that is perfectly legal tomorrow.

**Two things that make this class of fix fail silently:**
1. **The stored copy shadows the constant.** Every skill has an editable twin in
   `app_config → bot.settings`; fixing `skills.ts` alone changes nothing.
   `scripts/migrate-setter-skill-hours.ts` rewrites only text still matching the
   old default and reports anything hand-edited.
2. A rejected message is not sent — both send paths honour `validation.ok` and
   fall back to the canned template — so a too-strict rule costs the customer a
   real reply, not a wrong one. That is why the windows are hidden on non-booking
   turns.

### ⚠️ The setter must never name a superseded amount

`buildSalesContext` read `bot_quotes` — the questionnaire's own auto-estimate.
When Eli sends a real quote afterwards (a `factory_quote_requests` row with
`sent_to_customer_at`, or him pasting a price into WhatsApp) that number is
history. בתאל got "בהצעה של ₪2,610" for two days after Eli had sent her ₪4,470
and ₪5,800. `findNewerCustomerQuote` now checks both sources; when something
newer exists, `quote.totalIls` is **null on purpose** (he routinely sends two
quantities as options, so picking one would be a guess) and the money guard in
`validateMessage` then rejects any ₪ figure in the message.

### ⚠️ A file is never a spec change

`handleDecisionInbound` passed only the caption to `handleDecisionStage`, so an
image's caption was classified as text. Eleven_Four_jeans sent his logo with the
caption "logo black boxer -2" — the extractor "read" a colour count out of it,
the bot cut the order from 2 print colours to 1 and re-sent the whole opening
block (quote + about-us + links) one minute after he had received it. He
answered "המחיר לא רלוונטי" and the lead is LOST. Media at the decision stage
now routes to `handleLogoStage` like everywhere else: acknowledge, DM Eli, pause
the bot. A wrong label on an escalation costs nothing next to a wrong requote.

### What is configurable (settings screen, `bot.settings`)

~30 fields across 10 groups, including: all editable customer copy, the
follow-up cadence per stage (`"2,12,23"` = hours per attempt, clamped so a `0`
cannot become a spam loop — see [followup-cadence.ts](lib/autoresponder/followup-cadence.ts)),
the auto-resume window, the setter's 10 tactics, **the two analyst briefs**,
and every model. Adding a field: schema → FIELD entry → **wire it**; an unwired
field is a lie.

**The analyst prompts split in two** ([analysis-defaults.ts](lib/bot-settings/analysis-defaults.ts)):
the BRIEF is editable, the JSON SCHEMA is not and is appended in code. Every
schema field is read by name downstream (GHL note, callback task, setter
dossier) — an edited schema would end analysis silently, not degrade it. The
defaults live in a pure client-safe module ON PURPOSE so the settings screen
can display them; importing them from the analysers would drag a server module
into the client bundle.

### Models — one job each, all in settings

| Job | Setting |
|---|---|
| Answers customers | `setterModel` |
| Transcribes calls | `transcribeProvider` + `transcribeModel` |
| Analyses the transcript | `analysisModel` |
| Writes "why it's stuck" | `analysisModel` |
| Understands the customer | `intentModel` |

**Speaker separation is a PROVIDER choice, not a model choice.** No OpenAI
transcription model diarizes. `transcribeProvider: "elevenlabs"` uses Scribe
(reusing the voice-agent key), returns "דובר 1 / דובר 2", and also clears
Whisper's 25MB ceiling. Falls back to OpenAI on any failure.

Three settings were LIES until 2026-08-17 — `analysisModel` did not reach call
analysis, `intentModel` did not reach reply suggestions, and transcription had
no setting. If a dropdown seems to do nothing, suspect this class of bug.

### bot_paused carries a reason and expires

A bare boolean left **81 of 117** active leads muted forever, so the setter
could reach 5 leads in the entire system. Leads now carry `bot_paused_at` /
`bot_pause_reason` / `bot_pause_sticky`, and an hourly sweep expires only the
reasons meaning "a human is driving this one": `human_reply`, `escalation`,
`logo_received`, `reengagement_reply`. `opt_out` and `human_handoff` are
promises to the customer and NEVER expire; `deal_won`, `no_reply` and
`manual_toggle` are deliberate.

**⚠️ GHL can un-pause, but not a customer's opt-out (fixed 2026-08-18).**
`bot_paused` is a GHL-owned shared field, so every resync pushes its value
back — and the three write sites set that one boolean bare while `pauseFields`
writes three columns. So a resync silently woke leads the bot had muted and
left `bot_pause_reason` behind as a ghost. Visible symptom: an escalated lead
came round again on the next tick, tripped the same cap, and DM'd Eli a second
time within the hour. `ghlPauseChange` / `applyGhlPause`
([bot-pause.ts](lib/autoresponder/bot-pause.ts)) now own that decision:
`opt_out` and `human_handoff` are **irrevocable from GHL** (promises to the
customer, not workflow bookkeeping), everything else stays Eli's to override,
and an un-pause clears the reason columns. `escalateLead` also suppresses its
DM when the lead is already `NEEDS_ELI`. If a pause "doesn't stick", this is
the first thing to check.

**Always pause via `pauseFields(reason)`** ([bot-pause.ts](lib/autoresponder/bot-pause.ts)).
A pause written by hand lands unattributed and becomes un-diagnosable again.
Resuming must reset `followUpCount` (else the first nudge trips the 3-strike
escalation and re-mutes instantly) and clear `botPauseSticky`.

### Scheduling reality

Sub-daily work runs on **GitHub Actions**, not `vercel.json` — the Vercel plan
fires crons once a day, which is why the follow-up cadence was fiction for
months (56 of 65 followed-up leads ever got exactly one nudge). GitHub disables
scheduled workflows after 60 days of repo inactivity; that is the expected way
this dies. `followups` claims a row in `app_config` for the length of a run so
overlapping triggers cannot double-send — **not** a pg advisory lock, which
Neon's per-query HTTP driver silently drops (verified: it granted the same lock
twice).

**The follow-ups tick runs to 120s, and three values must agree (2026-08-18).**
`maxDuration` in [app/api/bot/followups/route.ts](app/api/bot/followups/route.ts)
is **120**, and the workflow's `curl --max-time` is **150** — curl must OUTLAST
the function, or it aborts first and hands back an empty body that looks
identical to a timeout. The comments naming the ceiling (route + the workflow's
error text) are part of the same change; leaving them at 60 misinforms whoever
reads them next. The 5-minute run-lock still exceeds a 120s run, so a killed
lambda cannot wedge follow-ups shut.

**Why the failure emails looked like a bug and weren't.** A tick that composes
several LLM messages crossed the old 60s ceiling, Vercel killed the lambda, and
curl returned nothing — which the old workflow piped straight into `json.load`,
so it surfaced as `JSONDecodeError: Expecting value: line 1 column 1`, naming
neither the endpoint nor the timeout. The step now captures body and status
separately, **retries once after 30s** (safe: the run-lock returns
`already_running`, so nobody is nudged twice), prints the actual response when
it isn't JSON, and treats `ok:false` as failure. Genuine breakage still fails
loudly — the inbox should mean something. If failures become *routine* rather
than a blip, the fix is fewer leads per tick, not a bigger timeout.

### "להתקשר בעתיד" — the parked bucket books calls (built 2026-08-17)

`FUTURE_FOLLOW_UP` held **45 active leads** — the largest non-terminal bucket in
the system, 25 holding a quote we wrote — and **nothing touched them**: no rule
matched the stage, `pipeline-audit` listed it under `HANDS_OFF_STAGES`,
`ghl-tasks/derive` left it out of `ACTIVE_STAGES`, and `lib/ghl/next-action.ts`
mapped it to `schedule_callback`, a string no code reads. Every tick they landed
in `no_rule` and were dropped.

**The objective is a booked phone call, not a reply.** The setter already knew
how (`goal: revive` → `ghost_recovery` + `appointment_booking`), and
`handleCallbackReply` was already the only text→task bridge in the codebase.
What was missing was a rule to reach them and a bridge to catch the answer.

- **Rule** in `STAGE_RULE_SHAPES` — cadence `168,168,336,504` (widening on
  purpose), **bounded** at 4 (unlike RE_ENGAGEMENT, which may run forever because
  Eli fills it one deliberate decision at a time). `gate` + `maxAttemptsKey` +
  `dailyCapKey` are new per-rule fields; the gate lives in
  [lib/autoresponder/future-followup.ts](lib/autoresponder/future-followup.ts).
- **Entry is MANUAL** (Eli, 17.8). Exhausting the normal follow-ups still freezes
  a lead at `NEEDS_ELI` + a permanent `no_reply` pause, exactly as before.
- **Ships OFF** — `futureFollowupEnabled`, plus five knobs (cadence, attempts,
  daily cap, min silence, max age). A **dry run ignores the master switch** so
  the messages can be reviewed without handing the 15-minute cron a live
  population of cold customers.
- Every message carries the opt-out footer via `withOptOutFooter`, so enabling
  this **will produce some LOST leads** — that is correct, a decided lead beats a
  frozen one, but it should not be a surprise.

**Four things would have made it inert, and each is a trap worth recognising:**
1. **The 7-day restart ate the reply.** `isNewConversation` restarts the
   questionnaire for anyone silent that long — which is every lead this loop
   targets. A customer answering "מחר ב-11" would have been asked their quantity
   again. Both revival stages and any lead with `callbackFlow='awaiting_reply'`
   are now exempt, in **both** webhooks.
2. **`revive` is gated on a quote existing**, and 20 of the 45 have none. They
   fell to `hold_back`, whose messages `validateMessage` **forbids** from naming
   a time — the bot was mechanically barred from its one job. A parked-stage
   branch in [strategy.ts](lib/setter/strategy.ts) books the call anyway.
3. **`follow_up_count` was never reset on a stage change**, so a lead dragged in
   from an exhausted INTAKE arrived with its budget spent (22 of 45).
   `enterFutureFollowUp` fixes entry; `scripts/_prepare-parked-bucket.ts`
   backfilled the residents.
4. **A non-time reply reached no handler at all** — the routing chain covers
   INTAKE/FACTORY_WAIT/CONSIDERATION/DISCAVERY only, so a cold lead who finally
   wrote back got silence. It now routes to `handleReengagementInbound` with
   `openTask`.

**⚠️ `leads.last_response_at` is a dead column** — readers in
`ghl-tasks/derive.ts` + `reconcile.ts`, **zero writers** anywhere. Any gate built
on it passes everything. (Which also means `derive.ts`'s `idle_active_lead` task
has never fired — separate ticket.) Silence age is computed from `messages`.

**The `skipped_*` buckets are the point.** Everything unhandled used to collapse
into `no_rule` (34 of 120), and that one undifferentiated bucket is how 45 leads
stayed invisible for months. A dry run now separates "the rule said not yet"
(`skipped_snoozed` / `too_fresh` / `too_cold` / `quota` / `internal`) from "nobody
wrote a rule". Verified 17.8: `no_rule` 34 → 13, exactly the 21 unpaused parked
leads.

**The daily cap is not optional.** On the first enabled tick every parked lead is
due at once (their `last_follow_up_at` is null), and the 15-minute cron would
drain the backlog in an afternoon. `claimFutureDailySlot` is the same
`app_config` row-claim as the run lock, atomic under a Jerusalem-day reset. A dry
run counts against it **in memory only** — otherwise the preview both lies about
the day and blows the 60s route budget composing 40+ LLM messages.

## Bot never auto-advances pipeline stage (2026-07-01 rule)

The bot USED to write `pipelineStage: "FACTORY_WAIT"` from five sites in the
autoresponder — questionnaire routing to factory, calc-API fallback, customer
"accept" intent, logo-image inbound, logo-URL inbound. **All five now write
`INTAKE`.** `qState.subFlow` still tracks `awaiting_logo` /
`awaiting_factory_estimate` so the autoresponder knows what to do next;
`NEEDS_ELI` flag and Eli DM still fire so nothing gets lost. **Only the
pipeline stage stays put** — Eli moves it himself via the audit UI or GHL.

`ensureAutoTaskForStage` in [lib/crm-tasks/auto-task.ts](lib/crm-tasks/auto-task.ts)
is now called from every stage-write site (setLeadStage, questionnaire
completion, configurator upsert), so the "נפלו בין הכיסאות" list stays at
zero for future leads.

## Task ownership — auto-tasks follow the LEAD'S GHL owner (2026-08-02 rule)

The 2026-07-01 "every task → Itay" rule evolved twice:
- **2026-08-01:** the default owner became **settings-driven** — `crm.assignee`
  in `app_config` (settings screen → [components/settings/AssigneeSection.tsx]),
  read by `resolveAssigneeUserId()` in [lib/crm-tasks/assignee.ts], env
  `GHL_SALESPERSON_USER_ID` as the fallback. This sets who OWNS new leads
  (the opportunity/contact owner on first sync — [sync.ts] `createOpportunity`).
- **2026-08-03 — two assignment MODES.** `crm.assignee` now carries a `mode`:
  `single` (one person owns all new leads, back-compat with the bare `{userId}`)
  or `round_robin` (`{rotation:[{userId,name}…], cursor}` — lead #1 → member[0],
  #2 → member[1], wrapping). The cursor advances **exactly once per new lead**
  via `assignNextLeadOwner(sid)`, which is idempotent per lead: it stamps the
  picked owner on `leads.owner_id` (a previously-dead column, nothing else reads
  it) and reuses it, so the contact + opportunity of ONE lead get the SAME owner
  and the cursor doesn't double-advance. `resolveAssigneeUserId()` stays PASSIVE
  (never advances — it's the task-fallback resolver); only the two new-lead owner
  sites in [sync.ts] (`upsertGHLContact` first push + `createOpportunity` create)
  call `assignNextLeadOwner`. Atomic advance = one `jsonb_set` UPDATE with modulo
  (`cursor = (cursor+1) % len`). `setRoundRobin` resets cursor to -1 so the first
  lead after saving goes to `rotation[0]`. Existing leads are untouched (they
  already have a contact/opp id → neither owner site fires).
- **2026-08-02 (the important one):** an **auto-task now goes to the LEAD'S
  ACTUAL GHL owner**, not the settings default — a task on Itay's lead lands on
  Itay. `resolveTaskAssigneeForSid`/`ByContact` fetch the GHL contact's
  `assignedTo`; the settings default is only the fallback for a lead with no
  owner yet. `leads.ownerId` is NULL for everyone — ownership lives only in GHL,
  so we read it live from `getContact(id).assignedTo`. `syncTaskToGHL` mirrors
  the task's stored assignee (falling back to the contact owner).

  Bug it fixed: every auto-task was assigned to whoever sat in `crm.assignee`
  (Elazar), so tasks on Itay's leads landed on Elazar. Validated on live GHL:
  10/12 sampled leads are Itay's → their tasks now route to Itay.

| Path | Assignee source |
|---|---|
| Auto-task on stage entry ([auto-task.ts]) | lead's GHL owner ?? settings |
| Push to GHL create/update ([sync.ts] `syncTaskToGHL`) | task's stored assignee ?? contact owner ?? settings |
| New lead's opportunity owner ([sync.ts] `createOpportunity`) | settings default (unchanged) |
| Manual UI create ([app/actions/v2.ts]) | user-picked ?? settings default |
| Pull from GHL resync ([resync-helper.ts]) | GHL task's own assignee ?? settings |

The nightly cron sweep catches any row that slipped through.

## Albadi Lead Score — lives on the CONTACT (moved 2026-08-24)

HOT / WARM / COLD, set by hand by Eli on the GHL contact card. It describes the
**lead**, so it belongs to the Contact.

**It used to be an OPPORTUNITY field** (`opportunity.albadi_lead_score`, id
`gNojMCZVszE5m2k8jvXh`, created 2026-05-23, **deleted 2026-08-24**). That was
wrong here specifically:
a GHL contact in this account routinely holds **several** opportunities (the
whole reason `reconcileStagesFromGhl` has a newest-wins rule), so one lead could
carry several conflicting scores with no rule saying which one counted.

| | |
|---|---|
| Field | `contact.albadi_lead_score` |
| Id | `zneBwsG0dSB3ajj8lnjv` |
| Type | RADIO, `picklistOptions` HOT/WARM/COLD, `isAllowedCustomOption: false` |
| DB mirror | `leads.albadi_lead_score` |
| Code | [lib/ghl/albadi-lead-score.ts](lib/ghl/albadi-lead-score.ts) |

**GHL owns it, DB follows** — the standard shared-field rule. In: the native
`ContactUpdate` app-webhook → `resyncContact` → `normalizeAlbadiLeadScore` →
`leads.albadi_lead_score`. Out: `buildCustomFieldsPayload` pushes it, but
**only when non-null** — Eli sets this by hand, so pushing null on an unrelated
sync would wipe his choice. Write from code via `setAlbadiLeadScore(sid, band)`,
never by touching the column directly, or GHL and DB drift.

**⚠️ `leads.lead_score` is a DIFFERENT, unrelated column** — a legacy NUMERIC
band (0/5/20/30/40/45/55) from the ManyChat scoring engine, plus one stray
"HOT" row. Do not conflate them; do not "consolidate" them. Its GHL counterpart
(`GHL_FIELD_LEAD_SCORE`) was deleted from GHL on 2026-06-08, and the resync
branch still reading it was dead code that would have written "HOT" over a
number had the field ever come back — removed 2026-08-24 along with the stale
`lead_score` entry in `GHL_FIELD_IDS`.

**The field id is hardcoded as a fallback** in `GHL_FIELD_IDS.albadi_lead_score`
so no Vercel env write was needed; set `GHL_FIELD_ALBADI_LEAD_SCORE` to override.

**No GHL Workflow is involved** (all 5 in this account are Draft anyway) and no
Automation, filter or integration referenced the old opportunity field — grep
confirmed the codebase never read or wrote it at all. It was purely manual.

**The opportunity field is DELETED** (2026-08-24, at Eli's instruction, after
the 4 values were migrated and verified on the contact). The location now has
**zero** opportunity custom fields — so a `?model=opportunity` list coming back
empty is correct, not a broken token. Snapshot of what it held, if it is ever
needed: Netanel HOT · Lilach HOT · יוסי COLD · Dor Turgeman COLD.

**Two things that bit the deletion, both worth knowing:**
1. **Someone can still be USING a field you are about to delete.** A 4th value
   (Dor Turgeman COLD) appeared on the opportunity field ~1 minute before the
   delete — Eli set it by hand out of muscle memory while the old field was
   still on the card. The delete script refuses to run unless every opportunity
   value is already present on the contact, which is the only reason it wasn't
   destroyed. Keep that pre-flight check in any future field migration.
2. **GHL's custom-field list is stale right after a DELETE.** The list endpoint
   still returned the deleted field, so the verification read "delete FAILED"
   when it had actually succeeded. Confirm a deletion by `GET`ting the field id
   directly — a gone field answers `400 "The custom field id or field_key is
   invalid"` — not by re-listing.

Smart Lists are a Contacts-only feature and never could filter the Opportunity
field — which is why this move was a precondition for the list, not just tidier
modelling.

**Smart List:** `🔥 HOT Leads` (id `vUM1kYCevw0Lc3D4kV1S`), filter
`Albadi Lead Score Is HOT`. Eli wanted **only** the HOT list — deliberately not
one per band; WARM/COLD are noise he doesn't work from.

**⚠️ Smart Lists have no public API** — `/contacts/views` answers
*"We are not supporting OAUTH requests right now"*, every other candidate path
404s. This one was built by driving the GHL UI. Don't burn time hunting for an
endpoint; the flow is Contacts → Filters → field → Apply → "Unsaved changes" →
*Save as new smart list*. Note "New smart list" in the name box is a real
VALUE, not a placeholder — clear it or the name comes out concatenated.

## Messaging a colleague — "שלח לסיימון הודעה" (built 2026-08-25)

When Eli says *send X a message* mid-session, X is usually a **colleague, not a
lead**. Use [lib/notify/team.ts](lib/notify/team.ts):

```ts
import { sendTeamDM, findMember, loadTeam } from "@/lib/notify/team";
await sendTeamDM("סיימון", "…");   // id / name / alias all match
```

CLI (no code needed):
```bash
DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/team.ts list
# … team.ts add <id> <name> <phone> <he|zh|en> "<role>" [aliases]
# … team.ts dm <id-or-name> "<text>"        ← sends a real WhatsApp
```

**⚠️ NEVER add a colleague to `leads`.** The bot would follow them up, they'd
sit in the pipeline, and they'd skew every analytics screen. The registry is
`app_config` key `crm.team` — same place and reasoning as `crm.quoteNotify`, so
**a phone number never lands in git** and re-pointing needs no redeploy.
Registered today: `simon` — 中文, buys from and talks to the Chinese factories.

**⚠️ Registering them is only half of it — the INBOUND webhook has to know too
(fixed 2026-08-30).** The registry protected sends; the Green webhook still saw
an unknown number. When Simon answered a question we had sent him, it made him
a lead, synced a GHL contact, and the bot opened the **Hebrew questionnaire** on
him and nudged him again hours later — he replied *"can you explain to me in
English?"* and Eli had to apologise for the bot. Both handlers in
[greenapi/webhook](app/api/greenapi/webhook/route.ts) now call
`findTeamMemberByPhone(chatId)` **before** `upsertLeadFromGreen` and return
early — no lead, no GHL contact, no bot, in either direction. Any NEW inbound
path must do the same; the registry alone will not save you.

Side note from that incident: **GHL rewrites a foreign number to the location's
country.** Simon's `+8615180009512` came back from `ContactCreate` as
`+9728615180009512`, and the resync mirrored that into `leads.phone_e164`. The
sid/JID stayed correct, so sending still worked — but don't trust `phone_e164`
for a non-Israeli contact.

Sends go out as `sender='eli'` through the normal `sendBridgeMessage` path, so
the message is recorded in `messages` like any other outbound. The GHL mirror
will log `ghl_mirror.skip reason=no_lead` — expected and harmless; a colleague
has no GHL contact.

**Always show Eli the text and the recipient before sending.** A DM to a real
person is not undoable, and Chinese-language messages he can't proof-read are
exactly where a mistake costs the most.

## Website leads — recognised from the WhatsApp prefill (built 2026-08-30)

The site's WhatsApp buttons open `wa.me/972559662713` — **the same GreenAPI
number every other lead uses** — so a website lead arrived indistinguishable
from any cold inbound. Measured before the fix: **58 of 89** WhatsApp-origin
leads had `lead_source` empty, and there was no way to tell whether the site
produced anything.

The one signal available is the sentence the site prefills into the message box
(`whatsappHref` in the albadi-web repo, `lib/contact.ts`).
[lib/leads/website-origin.ts](lib/leads/website-origin.ts) matches a
**distinctive fragment**, not the whole string — customers routinely edit the
text before sending — and the webhook calls it on every inbound:

| Button | Fragment matched | `source_detail_1` |
|---|---|---|
| page CTA (he/en) | `באתר ואשמח להצעת מחיר` · `would like a quote for branded non-woven bags` | `page_cta` |
| landing page | `הגעתי מגוגל` | `landing_google` |
| after the lead form | `הרגע השארתי פרטים באתר` | `after_lead_form` |

`lead_source` is filled with `COALESCE(…, 'website')` — a lead already
attributed to facebook/google **keeps** that attribution, because the prefill is
a later touch, not a re-attribution. A `source_touches` row is written either
way, with the page name (the site interpolates it into quotes) in
`source_detail_2`, so the full journey stays visible.

**If the site copy changes, update the fragments** — they are the whole
mechanism, and nothing fails loudly when they stop matching. The tell is
`lead_source` going quiet again.

## "צבעים" tab — the factory colour catalogue (built 2026-08-25)

Hub tab `colors` ([app/widget/colors](app/widget/colors/page.tsx) →
[ColorCatalogScreen.tsx](components/colors/ColorCatalogScreen.tsx)). Answers one
question: **which colour can we promise a customer before we know which factory
gets the order.**

Data: [lib/colors/factory-catalog.ts](lib/colors/factory-catalog.ts) — a
client-safe const module (no env, no server imports), **not** a DB table and
deliberately with no edit screen; the source PDFs change about once a year, so
changing a shade means editing a line. Regenerate from
`content/albadi/color-catalogs/out/{MASTER,FACTORY3_CLEAN}.json`, which sit next
to the four source PDFs.

⚠️ **`lib/constants/bagColors.ts` is a different thing** — `BAG_COLORS` drives
the 3D configurator's render. This module is what you *order from a factory*.
Don't merge them.

**Where the numbers came from.** The four `MATERIAL COLOR n` PDFs in the Feishu
folder `RSvLfcR4ull7BudymWQcWPfYnpg` are catalogues of **fabric mills**, not of
the bag factories — the file *names* carry the factory (WEIWEI / CHEN / MANDY),
and MANDY alone offers two mills (`MATERIAL COLOR 3` + `4`). Each of the 168
shades was sampled from a large fabric area beside its label, white-balance
corrected against the paper in the same photo (PINSEN was shot under much warmer
light — without the correction it skews orange), then compared with CIEDE2000.
14 shades exist at all three factories; those are the catalogue.

**Codes do NOT translate between factories.** `R08` at one mill is a bright red,
at another a magenta. Any surface that shows a colour must show the per-factory
code, never one code.

**Which factory serves which bag** — from the Feishu sheet *Classification of
non-woven bag material selection* (`RFd0stnYfh6H2BtFHZZc1cD2nme`, also tab
`MSlBqQ` of the quotes workbook). This is the `whenToUse` bubble on each factory:

| Factory | Catalogue | When |
|---|---|---|
| `CHEN` | MATERIAL COLOR 2 | **every bag type** — the only one that covers the whole matrix |
| `WEIWEI` | MATERIAL COLOR 1 | hand-sewn (flat + gusseted) and heat-press flat. **Never heat-press 3D** |
| `MANDY` (浙江华庆) | MATERIAL COLOR 3 + 4 | **heat-press 3D only** |

So the four mills are never all available at once, and `CHEN`'s 32 shades are
the one palette that works for any bag. Quote share for context (column S of the
quotes tab, 62 quotes). **The catalogue names are the CONTACTS, the sheet
records the FIRMS** — no sheet maps between them; Simon confirmed it by hand on
2026-08-27:

| Catalogue name | Company (column S) | Share of quotes |
|---|---|---|
| `MANDY` | 浙江华庆塑业有限公司 | 37% (23) |
| `WEIWEI` | 温州亚森制袋 | 26% (16) |
| `CHEN` | 浙江鼎驰新材料科技有限公司 | 23% (14) |

The remaining ~14% is eight one-off suppliers. Eli works by the contact name, so
that is what the UI leads with; the company name is the secondary line.
Worth noticing: `CHEN` is the only fabric that fits every bag type, yet it takes
the *smallest* share of the big three.

**Measured from photos, not a spectrophotometer.** Good enough to build the
shortlist, not to commit to a customer — the screen says so, keep it that way.
Near-whites and very dark shades are the least reliable (white fabric shot in
shade measures grey).

## Display labels: use Eli's working vocabulary

Only stage labels changed 2026-07-01 — the internal keys (`INTAKE` /
`DISCAVERY` / `FACTORY_WAIT` / `CONSIDERATION` / `WON` / `LOST`) are
untouched. Every UI surface reads:

  INTAKE        → **קליטה**              (was: שאלון + הצעה אוטומטית)
  DISCAVERY     → **אפיון**              (was: שיחת בירור)
  FACTORY_WAIT  → **מחכה למפעל**          (was: בדיקת מפעל)
  CONSIDERATION → **שוקל / משא ומתן**    (was: שוקל הצעה / מו״מ)
  LOST          → **אבוד**               (was: לא נסגר)

Source of truth: `V2_STAGE_LABELS` in
[lib/manychat/stages.ts](lib/manychat/stages.ts). NULL and INTAKE both
render as "קליטה" in the audit — Eli doesn't distinguish "still in
questionnaire" from "questionnaire done + auto-quote".

## Lead analyzer — the "נתח" button (built 2026-06-26)

Per-lead **bottom-up** sales analysis to understand why leads stall, surfaced
inside GHL. Replaces ad-hoc "read a few calls and guess". Lives in
[lib/analysis/](lib/analysis/).

**Engine ([lib/analysis/analyze-lead.ts](lib/analysis/analyze-lead.ts)):**
`analyzeLead(sid, {force})` →
1. **dossier** ([build-dossier.ts](lib/analysis/build-dossier.ts)) — assembles
   ONE lead's full data: all call transcripts+analyses (GHL calls join
   `ghl_contact_id`, ElevenLabs join phone digits), full WhatsApp timeline
   (`messages`), quote history (`bot_quotes`). Hebrew render + `hashDossier`.
2. **cache** — `input_hash` (hash of the dossier). If the latest `lead_analyses`
   row matches → return it (no LLM, no cost). New message/call → hash differs →
   re-analyze. This is why repeat clicks are instant + free.
3. **judge** — gpt-4o (`LEAD_ANALYSIS_MODEL` || `OPENAI_ANALYSIS_MODEL` ||
   "gpt-4o") fills a strict structured verdict (`LeadAnalysis`): root_cause,
   `primary_blocker` (closed enum), objections w/ verbatim quotes,
   price_forensics, commitment_scorecard, etc.
4. **grounding self-check (the anti-cherry-pick guardrail)** — `isGrounded()`
   drops any objection whose quote isn't actually present in the dossier.
   DETERMINISTIC, not a second LLM pass.
5. **persist** `lead_analyses` + **post GHL contact note** (marker
   `[LEAD-ANALYSIS v1] sid=<sid> h=<hash8>`, dedup via `listContactNotes`).

**Data model:** `lead_analyses` (manychat_sub_id, verdict jsonb, input_hash,
model, version, created_at) — created via direct DDL, NOT `drizzle-kit push`
(push hangs on a create-vs-rename TUI prompt re: orphan `configurator_*`
tables). Latest row per sid is the current verdict.

**Surfaces (both frontends):**
- **Per-lead:** "🔍 נתח" tile in the widget inbox
  ([components/inbox/LeadAnalysisInline.tsx](components/inbox/LeadAnalysisInline.tsx))
  + "ניתוח" tab in v3 `ExpandedLead`. Endpoint
  [/api/widget/analyze-lead](app/api/widget/analyze-lead/route.ts) +
  `analyzeLeadAction`.
- **Filtered bulk + aggregate:** "🔍 ניתוח" hub tab
  ([components/analysis/AnalysisScreen.tsx](components/analysis/AnalysisScreen.tsx))
  + `/dashboard/v3/analysis`. Filter by stage/date/has-calls/batch, run+continue
  with progress, then a **deterministic rollup** of blockers/objections — a pure
  groupby over stored verdicts ([aggregate.ts](lib/analysis/aggregate.ts)), no
  second LLM → can't cherry-pick. Lib: [batch.ts](lib/analysis/batch.ts)
  (`analyzeBatch`, skip-already-analyzed). Endpoints
  `/api/widget/analyze-batch`, `/api/widget/analysis-aggregate`,
  `/api/admin/analyze-leads`, `/api/admin/analysis-aggregate`.

**Blocker → play (the salesperson script).** The verdict's `primary_blocker`
maps to a "play" (what to say now) — driven by the ANALYSIS, not the often-stale
manual `pipeline_stage`. Plays are **editable from the UI** ("✏️ ערוך פליז" in
the analysis tab) → stored in `app_config` key `sales.plays`
([plays-store.ts](lib/sales/plays-store.ts)), merged over `DEFAULT_PLAYS`
([stage-plays.he.ts](lib/sales/stage-plays.he.ts)). Full 6-stage reference:
[docs/SALES-PLAYBOOK.he.md](docs/SALES-PLAYBOOK.he.md). Objection→reply taxonomy:
[lib/sales/objection-playbook.he.ts](lib/sales/objection-playbook.he.ts).

**Core lesson — never let the LLM guess a fact the DB knows.** Two corrections
proved this:
- The judge's `followup_verdict` ("promised but didn't deliver") read **92%** —
  false. It conflated bot messages and missed delivered quotes. Replaced with a
  DETERMINISTIC rule in [aggregate.ts](lib/analysis/aggregate.ts): a drop = the
  CUSTOMER sent the last message and it's been >3 days. Real number **~13%**.
- Same principle as the quote grounding check. If a metric smells wrong, it's
  probably an LLM read that should be a direct query.

**Footguns:**
- **Prod-keys-only.** Engine needs OPENAI + GHL keys → only runs in prod.
  Locally `vercel env pull` masks them to empty, so `analyzeLead` soft-fails
  (and the soft-fail path does NOT persist → those leads retry next run). Test
  deterministic parts with `scripts/_test-lead-analysis.ts` (stubbed judge).
- **OpenAI 30K TPM tier.** Big dossiers (~46k chars) at concurrency 3 hit 429s.
  `build-dossier` trims render to ~14k chars and keeps summaries+messages first
  (transcripts are the trimmable tail). Bulk-seed paced: `scripts/_run-analysis-paced.ts`.
- **No physical samples (business rule).** Albadi does NOT send samples (delays
  the sale). The `sample_trust` play uses photos/video/social-proof, and the
  aggregate labels "asked to see product" as a SIGNAL, not a failure.
- To **seed all leads**: `POST /api/admin/analyze-leads` (BOT_SECRET, in prod)
  or click "נתח הכל" on the screen. Each gpt-4o call costs money.

## Callback-time flow — "מתי נוח לכם לדבר?" (built 2026-07-14, DORMANT/OFF)

When a lead goes quiet **recently** (30 min – 6h) in a trigger state, the bot
sends ONE context-aware WhatsApp asking when's a good time to talk; when the
customer replies with a time, a task opens for Itay + the bot confirms. Turns a
silent lead into a scheduled call.

**Gated OFF** behind `CALLBACK_REQUESTS_ENABLED=1` (not set in prod → deployed
but inert: the detector sends nothing, the inbound hook is dormant until a lead
carries `qState.callbackFlow`). Respects quiet hours + no-send days.

- **Triggers** (silent 30min–6h, once/lead): quote sent (INTAKE), questionnaire
  incomplete (NULL), brand-new lead never replied, GHL call `no_answer`. Windowed
  30min–6h so it does NOT blast the months-old backlog; internal/test leads
  excluded (name ~ אלבדי/test/config/בדיקה).
- **Code:** [lib/autoresponder/callback-request.ts](lib/autoresponder/callback-request.ts).
  Detector `POST /api/bot/callback-requests` (`?dry=1` = compose + return
  candidates, send nothing — safe review). Inbound reply→task hook is in
  [app/api/greenapi/webhook/route.ts](app/api/greenapi/webhook/route.ts) BEFORE
  the normal handlers. State: `qState.callbackFlow` (awaiting_reply/answered/declined).
- **To enable (needs Eli's OK — sends real customer messages):** (1) set
  `CALLBACK_REQUESTS_ENABLED=1` in Vercel prod; (2) add a ~30-min trigger (GitHub
  Action, like process-recordings) POSTing the detector; (3) test on ONE
  disposable lead first (reply with a time → task appears).

## Deal lifecycle — עסקאות tab + Zoho Books + "סגור עסקה" (built 2026-07-23)

Full post-sale flow: turn a finalized/draft quote into a tracked **deal**, know
the **real profit per customer** (planned vs actual, pulled from Zoho), and run
mockup/invoice/layout without leaving the widget. The old **"הצעות שנסגרו"** hub
tab is now **"עסקאות"** ([components/factory-flow/ClosedQuotesView.tsx](components/factory-flow/ClosedQuotesView.tsx),
[app/widget/hub/page.tsx](app/widget/hub/page.tsx) tab id `closed`).

### How a deal ENTERS the עסקאות tab

Source of truth: `listClosedQuotes` in
[lib/factory/server/closed.ts](lib/factory/server/closed.ts). A finalized/priced
quote shows when EITHER:
- **explicitly closed** — `closed_deal_at` set via the **"סגור עסקה"** button, OR
- **legacy auto** — `factory_status='finalized'` AND lead `pipeline_stage='WON'`.

Problem it fixed: only ~4 of 54 finalized quotes were WON, so ~50 real closed
deals were invisible. Three close paths, all decoupled from WON:
- **Single finalized** → "סגור עסקה" (row button, `POST /api/widget/factory/close-deal/[id]` → `setDealClosed`).
- **Combined (multi-product, one invoice)** → "סגור עסקה משולבת" (customer-group
  button when ≥2 finalized; `POST /api/widget/factory/close-deal-group` →
  `closeDealGroup` sets a shared `deal_group_id = dg_<primaryId>`).
- **Draft (customer accepted the estimate directly)** → "סגור עסקה (אומדן)" (draft
  row button); the deal card shows a **"לפי אומדן"** badge (`fromEstimate`), price
  = the estimate, not factory-confirmed.

Columns (direct DDL — drizzle-kit push hangs): `closed_deal_at`, `deal_group_id`,
`deal_milestones`, `actual_costs`, `draft_estimate` on `factory_quote_requests`.

### Combined deal (deal_group_id)

Quotes sharing a `deal_group_id` collapse into ONE deal card (`products[]`,
"עסקה משולבת · N מוצרים" badge).

**⚠️ Combined pricing = the COMBINED OFFER, frozen at close (2026-07-31 — this
REPLACES the 2026-07-23 "sum the members" rule; don't restore it).** Eli:
"אם אני כותב סגור עסקה משולבת אז ברור שמה שרשום שם הוא הקובע." A combined offer
ships ONCE — `allocateCombined` re-prices the group on the merged CBM and folds
the cheaper shipping back per product, so the customer pays materially less than
the standalone quotes add up to (יוסי גולד: **₪13,235 vs ₪14,210**, −₪975).
Summing the members therefore over-stated revenue and contradicted the PDF the
customer holds. It also can't be recomputed later — the allocation depends on
the manual merged CBM and any air/sea split that lived only in screen state.

So `closeDealGroup` **freezes** it: `buildCombinedPricing` (mirrors
`/api/factory/combine/pdf` exactly) writes a `CombinedDealPricing` to
`factory_quote_requests.combined_pricing` on the PRIMARY member — grand total,
per-product ALLOCATED pricing, merged shipping option, cbmOverride, split. The
close endpoint accepts `cbmOverride` + `split` so a caller can freeze precisely
what it showed. `listClosedQuotes` then serves the allocated pricing per product
and exposes **`grandTotalExVat`** — the deal's canonical customer total, which the
card, the actual-costs defaults, the invoice modal, the Zoho invoice lines and
`/api/widget/deals` all read instead of each recomputing. Legacy groups with no
snapshot fall back to `combineMembers` (the old sum).

The single-shipment saving is NOT a retroactive discount to hunt for on the
actual side any more — it's already in the price the customer was quoted; Eli's
realized gain shows up as a LOWER actual shipping cost from Zoho.

Deal-level actuals/milestones/invoice live on the PRIMARY (oldest) member;
`deal id = primary id`. `dealMemberIds` returns all members for the multi-line
invoice. `unbindDealGroup` splits.

**Remove a deal (reversible):** each card has "הסר מעסקאות" → `removeDeal`
clears `closed_deal_at` on all members + unbinds the group (quote stays in
הצעות מפעל, re-closable). `POST /api/widget/factory/remove-deal/[id]`. A deal
shows if `WON OR closed_deal_at`, so for a still-WON lead clearing the stamp
doesn't hide it — `removeDeal` returns `stillWon` and the UI tells Eli to move
the lead off WON in GHL. Most deals are explicitly-closed (not WON) → vanish
cleanly.

### Deal file — post-WON timeline + files + GHL mirror

`DealMilestones` ([lib/factory/types.ts](lib/factory/types.ts)) — stages הדמיה →
חשבונית → פריסה → ייצור → משלוח → הגיע, each a stamp + optional files.
[lib/factory/server/milestones.ts](lib/factory/server/milestones.ts):
`saveDealMilestones` (merge), `appendDealFile`, `mirrorDealEventToGhl` (posts a
`[תיק עסקה]` note to the lead's GHL contact — non-fatal, no-op without
ghl_contact_id). Endpoints: `PUT /api/widget/factory/milestones/[id]`,
`POST /api/widget/factory/deal-upload/[id]?stage=mockup|invoice|layout` (Vercel
Blob under `deal-files/<id>/`, image/PDF/video ≤25MB). Stage-chip row + collapsible
ציר on each card. Quotes-tab finalized rows get a folder icon →
`/widget/closed-quotes?focus=<id>`.

### Profit reconciliation + accuracy

`QuoteActualCosts` ([types.ts](lib/factory/types.ts)) — real
`factoryTotalIls` / `shippingTotalIls` / `actualRevenueIls` / `otherCosts[]` /
`zohoRefs[]`. Card shows planned (finalPricing) vs actual, hero = real profit,
plus a **per-CBM** line (charged/CBM vs paid/CBM, basis = factory CBM). Save via
`PUT /api/widget/factory/actuals/[id]`.

**Draft-vs-factory comparison** (DraftVsFactoryStrip in QuotesHistoryView) +
**aggregate accuracy strip** (top of עסקאות, [lib/factory/server/accuracy.ts](lib/factory/server/accuracy.ts))
compare the **factory COST** (`unitCost`), NOT the selling price — that's what
Eli estimates and wants to validate. Rows: עלות מפעל ליחידה / סה״כ, CBM, שילוח,
and מחיר ללקוח as a reference. All deterministic (no LLM). **Units are "CBM"
everywhere, never m³** (Eli's working unit).

### Mockup / dieline — local bridge (generation stays local)

Generation stays on Eli's Mac (the `bag-mockup-video` + `dieline-print` Claude
Code skills — his ChatGPT/Gemini subs, reference photos, interactive tweaks;
server-side image gen deliberately NOT attempted). The CRM is the system of
record; [scripts/deal-file.ts](scripts/deal-file.ts) is the two-way bridge:
`pull <dealId>` prints a filled skill brief (dims/colors/handles/lam, downloads
the product photo) + `push <dealId> <mockup|invoice|layout> <file>` uploads the
result to the deal timeline. Config `CRM_BASE` (default prod) + `WIDGET_TOKEN`
(= `GHL_WIDGET_TOKEN`). Read endpoint `GET /api/widget/factory/deal/[id]`.

### Test deal

Lead `test:eli-demo` ("אלי — בדיקת מערכת", WON, phoneless) + draft TESTD1 +
finalized TESTF1 — KEPT on purpose (Eli). Reseed/clean:
`npx tsx scripts/_seed-eli-test-demo.ts --go | --cleanup`. It IS the accuracy-
strip data until removed (slightly pollutes aggregates).

See "Zoho Books integration" below for the money side.

## Post-close deal edits — "תוספות לעסקה" (built 2026-08-14)

A customer asks for 500 more at the price already agreed. Rebuilding a whole
quote for that is absurd, so a CLOSED deal takes free-form `{label, amountIls}`
lines — `factory_quote_requests.deal_addons` (jsonb, direct DDL, on the PRIMARY
member like every deal-level field).

**The amount goes INSIDE `grandTotalExVat`** ([closed.ts](lib/factory/server/closed.ts)),
which is the single definition of what the customer owes — so the payment
schedule and the Zoho invoice pick it up with no extra wiring. `productsTotalExVat`
is exposed alongside it (the products' own total, before additions). Verified:
₪6,820 + ₪1,080 → grand ₪7,900, and the 30/40/30 schedule sums to ₪9,322 =
7,900 × 1.18 exactly. The invoice gets a line per addon, so the bill can't come
out short of the quote.

**Telling the customer:** the original quote PDF is a historical document and
stays as sent — the delta goes out as a WhatsApp via **"שלח עדכון ללקוח"**
([sendDealUpdate.ts](lib/factory/server/sendDealUpdate.ts), `POST
/api/widget/factory/deal-update-whatsapp/[id]`, `?dry=1` previews). It states the
additions, the original total, the updated ex-VAT total and the recomputed
schedule, all from the same `payment-terms` module the quotes and the invoice
use. The UI ALWAYS previews and confirms first — it lands on a customer's phone.
Sent as `sender='eli'`, which also pauses the bot on that lead.

Endpoint: `PUT /api/widget/factory/deal-addons/[id]` (replaces the whole array).

## Factory quote — two more footguns fixed 2026-08-11

**Shipping-id namespaces leak, and the miss cost ₪0 shipping.** The calculator
engine uses `s1` (אקספרס/air) / `s2` (רגיל/sea); the factory config uses
`air-express` / `sea-standard`. A quote built on the calculator side stores `s2`,
`priceFactoryQuote` looked it up, found nothing, and charged **zero shipping** —
under-quoting ~₪1,874 on 3,000 bags. `resolveShippingOption`
([pricing.ts](lib/factory/pricing.ts)) now translates the legacy ids and falls
back to a sea option **with a warning, never to no shipping**. Symptom to watch
for: a quote whose shipping line is ₪0.

**Finalized quotes never re-read the sheet.** `refreshFromFeishu` skips
`finalized` rows on purpose (a sweep must not overwrite a priced quote), but the
factory does edit rows after we price them (VIHFR5BJ moved ¥1.65 → ¥1.75
unnoticed). The 🔄 **"רענן מהמפעל"** button on finalized/received rows
([force-refresh.ts](lib/factory/server/force-refresh.ts)) force-pulls one quote,
shows the diff in Hebrew, and updates `factory_response` **only** — it never
re-prices, because `final_pricing` is what the customer was quoted; a changed
cost is surfaced as "pricing is stale, recalculate if needed".

## Quote-sent notification is settings-driven (2026-08-10)

Itay used to be pinged on WhatsApp for every quote sent, hardwired to
`ITAY_NOTIFY_JID`. The recipient now lives in `app_config` key `crm.quoteNotify`
`{enabled, phone, name}` ([quote-notify-config.ts](lib/notify/quote-notify-config.ts)),
edited from the settings screen ("התראה על שליחת הצעה ללקוח"). **Currently
DISABLED.** The env var is only the legacy fallback; the JID cache is per-target
so re-pointing takes effect without a redeploy.

## Zoho Books integration — read + write (built 2026-07-23)

Creds reused from Eli's local project `/Users/eli/Projects/zoho/`
(`secrets.json` + `config.json`, org **929765814**, DC **com**) and copied to
Vercel prod env (`ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN/ORG_ID/DC`). His local
**zoho-invoice skill** (`~/.claude/skills/zoho-invoice/SKILL.md`) is the spec the
CRM ports. `zohoConfigured()` false → every path soft-fails to a "not connected"
state. Access token cached in `app_config` key `zoho.token`.

**How his books are ACTUALLY structured (probed live — don't assume standard):**
- **Factory payments = EXPENSES on "Cost of Goods Sold"**, not vendor bills (bills
  empty). CNY/USD, often split 30%/70%, `customer_id`-linked.
- **Commissions = EXPENSES on "עמלות מכירה"**, customer-linked.
- **Invoices are INC-VAT (18%)** while CRM quote totals are EX-VAT → compare/fill
  with `total/1.18`.
- `bcy_total` = ₪ at the booked rate — prefer over live-FX for foreign docs.
- **Plan blocks foreign-currency EXPENSES via API** (`code 3048`). Factory is
  always ¥ → `createZohoExpense` CONVERTS to ₪ at the live rate and keeps the
  original ¥ in the description.

**Read side** ([lib/zoho/client.ts](lib/zoho/client.ts) + [match.ts](lib/zoho/match.ts)):
list invoices/bills/expenses, deterministic doc→deal scoring (name/amount/date),
FX-converted ₪. Endpoints `GET /api/widget/zoho/match?dealId=` (ranked
suggestions) + `/api/widget/zoho/unmatched` (docs not yet linked). UI: **"משוך
מ-Zoho"** modal fills actualCosts + `zohoRefs`; revenue filled EX-VAT.

**Write side** ([lib/zoho/write.ts](lib/zoho/write.ts)):
- `createZohoInvoice` — ensureCustomer (auto-creates), consecutive number
  (`ignore_auto_number_generation`), 18% VAT on EX-VAT lines
  (`default_tax_id 433486000000133001`), `targetTotal/qty` exact-rate trick, bank
  details in Notes, mark Sent unless `draft`, pull PDF. Accepts `lineItems[]` →
  combined deals get ONE invoice with a line per product.
- `createZohoExpense` — cogs→`433486000000034003` / commission→`433486000000163002`
  / custom account; paid through a **payer** — אלי / שמעון / **העסק (Pepper)**
  (`PAYER_ACCOUNTS`, Pepper bank `433486000000173002`); no VAT (imports);
  customer-linked (`findCustomerId` fuzzy); foreign→₪ conversion. `applyTo` rolls
  the ₪ into the deal's actualCosts bucket (rounded — kill float drift).
- UI: **"צור חשבונית ב-Zoho"** (deal-file invoice stage) + **"רשום הוצאה ב-Zoho"**
  (card button). Endpoints `/api/widget/zoho/create-invoice` + `/create-expense`
  (GET on the expense path lists accounts).

**Per-CUSTOMER consolidation — the reporting tag is REMOVED (Eli's call).** He
wants everything grouped under ONE customer, not split per order (a customer's 2
orders should SUM, not show as 2 columns). The `customer_id` link does that; the
CRM no longer applies the "הזמנה" reporting tag (Zoho's create-option API is
disabled anyway). He sees per-customer spend via **Reports → Expense Details →
group by Customer**. His goal "כמה הוצאתי על כל לקוח" needs NO tag.

**Modals are opaque** — `--lux-card` is `rgba(...,0.03)` (near-transparent); all
Zoho modal boxes use a solid `#1b1917` panel + backdrop blur (a translucent modal
looked see-through over the deal card).

**Live-write safety:** creating a real invoice/expense writes to the live books
(consecutive numbers). Verified read + UI freely; live writes were create-then-
delete on the test deal, or gated behind Eli's explicit OK. Cleanup uses the Zoho
DELETE endpoints (`deleteZohoInvoice` / `deleteZohoExpense`, + `/contacts/{id}`).

## Skill "deliver" hub — send-to-customer + Feishu ORDER FOLLOW (built 2026-07-24)

The Albadi Claude Code skills (`bag-mockup-video` / `dieline-print` /
`zoho-invoice`) file + send their output through ONE CRM endpoint so credentials
stay server-side. `POST /api/widget/albadi/deliver`
([app/api/widget/albadi/deliver/route.ts](app/api/widget/albadi/deliver/route.ts)),
multipart `{file, customerName, customerSid?, kind(mockup|video|logo|factory_dieline|dieline|invoice),
send?(whatsapp), quotationNo?}`:
1. hosts the file on Vercel Blob (`albadi-files/<customer>/<kind>-<ts>.<ext>`),
2. attaches its link to the customer's row in the **"ALBADI ORDER FOLLOW"**
   Feishu sheet. Column map (Eli's correction 2026-07-24 — the 3 production-stage
   files of an order): **`factory_dieline`→col X** (die line, the blank template
   the factory first sends), **`logo`→col Y** (Grapgic, the logo the customer
   sent), **`dieline`→col Z** (Final Design, the FINAL production file = logo
   placed on the dieline). mockup/video (pre-sale 3D הדמיה) and invoice have NO
   column (skipped). All three production files ALSO save to the local customer
   folder. Match by Customer (col A); >1 order → `needQuotation` so the skill asks
   which Quotation No. Feishu auto-hyperlinks the URL. `GET ?customer=` returns
   the order rows **plus** matching CRM customers with `sid` + auto-pulled
   `size`/`handles` (from the lead's latest `factory_quote_requests.productSpec`).
3. with `send=whatsapp` + a lead `customerSid`, sends via
   `sendBridgeMessage(sid, caption, blobUrl, "eli", fileName)` (GreenAPI; PDF as
   a **document**). Reuses the send-to-customer path.

**Pre-sale vs post-close (Eli's rule).** הדמיה/mockup is pre-sale — the customer
is often not in the tables yet. So mockups: **no size/handles lookup** (ask the
user / defaults), **no local folder**, and **never append** an ORDER FOLLOW row
(`appendIfMissing=false` → attach only to an existing row, else just WhatsApp);
the customer name is asked ONLY at delivery to resolve the sid. פריסה/חשבונית are
post-close → save to the customer folder + may append a row.

Code: [lib/feishu/order-follow.ts](lib/feishu/order-follow.ts) (`findOrderRows` +
`attachFileToOrder`, own token/tab via `FEISHU_FILES_SHEET_TOKEN` +
`FEISHU_FILES_TAB_ID` — set in prod; soft-skips the sheet when unset). The Feishu
app already has write access to that sheet (no sharing step needed).

**Local side (Eli's Mac, NOT deployed):** shared helper
`~/.claude/skills/albadi/deliver.mjs` — each skill's SKILL.md has a
"מסירה ללקוח" section that (a) saves the file to
`/Users/eli/Projects/content/albadi/customers/<customer>/`, (b) POSTs to the
deliver endpoint. Config `~/.claude/skills/albadi/.env` needs
`WIDGET_TOKEN` (=GHL_WIDGET_TOKEN) + optional `CRM_BASE`. Customer lookup uses
`/api/widget/leads/recent?q=` for the sid.

**zoho-invoice skill relocated to global** (`~/.claude/skills/zoho-invoice/`) from
the project-local `/Users/eli/Projects/zoho/.claude/skills/`. `zoho_import.py`
self-locates config/secrets/state via `__file__`, so it's relocatable; the
SKILL.md now says to `cd` into the skill dir first (its relative
`state/invoice_input.json` writes need it). Verified E2E locally (helper → Blob →
Feishu row + customer folder); WhatsApp `--send` is prod-only.

## Payment-details template — VAT + schedule + bank (built 2026-07-28)

Every **manually sent** quote ends with what the customer owes and how to pay:
`מע״מ → סה״כ לתשלום → פריסת תשלומים → פרטי העברה בנקאית`. Header is
`*פרטי תשלום ופירוט חשבון*` (replaced the plain quote header; the 14-day footer
is gone).

**[lib/factory/payment-terms.ts](lib/factory/payment-terms.ts) is the single
source of truth** — client-safe (no server imports, per the client-bundle rule).
It owns `VAT_PCT = 18` and `BANK_DETAILS`, and **[lib/zoho/write.ts](lib/zoho/write.ts)
imports them** instead of its old private copies, so an invoice and the WhatsApp
message can never quote different numbers. Don't re-hardcode 18% or the bank
details anywhere.

**Two money rules — deliberate, don't "fix" them:**
1. The deposit is a share of the **VAT-INCLUSIVE** total (matches `buildTerms`
   and Eli's own example: 50% of ₪21,977, not of ₪18,625).
2. The **last installment absorbs the rounding remainder**, so the parts always
   sum to the printed total (30/40/30 → 6,593.31 + 8,791.08 + **6,593.32**).
   Same rule as `customerRoundedTotalIls` / `splitCustomerView`.

**Default since 2026-09-02: ON, at `30_70`** (`paymentTerms.includeByDefault`
+ `defaultPlanId` in `factory_pricing`). This REVERSES the 2026-08-03 "default
off" — Eli asked for it back after quotes went out bare for two weeks. It
governs BOTH sending and simply viewing a PDF: with no `?plan=`, the route
resolves the settings plan, so an ad-hoc view now prints the block too (and the
stale finalize Blob is never served, since `renderPlan` is no longer null).

⚠️ The toggle used to be a lie on the calculator screen: it hard-coded
`NO_PAYMENT_PLAN_ID` and POSTed it, and an EXPLICIT "none" is read as a
deliberate refusal — so the setting could not win no matter what it said.
`usePaymentPlanDefault` now seeds the picker from the config (a manual pick is
never overwritten when the fetch lands). The quotes list already read the
config, which is why only quotes sent from the calculator came out bare.

**Plans:** `50_50` · `30_70` · `30_40_30` (30% התחלה / 40% לפני משלוח / 30%
בהגעה) + `custom_NN`. Default in `factory_pricing.paymentTerms.defaultPlanId`
(backfilled by `normalizeConfig` — no migration), edited in the widget settings
"תנאי תשלום"; a picker on the quotes list overrides per send. Both
`send-whatsapp` routes accept an optional `paymentPlanId`; absent = the default.

**Wired into the FOUR MANUAL builders only** — finalized+PDF, combined,
calculator text, estimate. ⚠️ **The bot's questionnaire auto-quote
(`buildQuoteMessage`) is deliberately EXCLUDED** (Eli: a cold lead must not get
bank details). **Each builder feeds the block the total it actually PRINTED**
(`splitCustomerView(...).grandTotalIls` on a split) — never a recomputed one.

**One customer total, everywhere — `customerTotalExVat`
([lib/factory/customer-total.ts](lib/factory/customer-total.ts)).** The same
quote used to print THREE totals: the WhatsApp/PDF/payment block quoted
`round2(unit) × qty + molds` (what the customer agreed to pay) while the quotes
list, the deal card and the Zoho invoice read the engine's `totalSellingPrice`
(the UNROUNDED unit × qty) — ₪8,160 vs ₪8,106 on one line, so a deal contradicted
its own payment schedule and the invoice under-billed the quote. `customerTotalExVat`
is now the single definition (split-aware, molds included) and every
customer-facing/billing surface reads it; `memberDisplayTotalExVat` delegates to
it. **Internal cost/profit figures keep using the engine's exact totals.** For a
COMBINED deal the deal-level number is `grandTotalExVat` (the frozen combined
offer) — see "Combined deal" above.

The PDF prints the SAME payment block as the caption (VAT + amount due +
installments + bank) — [pdf.tsx](lib/factory/pdf.tsx) gated on `paymentPlanId`.
**Footgun fixed 2026-07-31:** `/api/factory/[id]/pdf` served the stored Blob
(`row.pdfUrl`) FIRST when set — but that Blob was rendered at finalize time,
BEFORE any plan existed, so it had NO payment block. Both the send and every UI
view got the stale ex-VAT PDF (Eli: "I don't see payment terms in the PDF"). The
route now re-renders fresh whenever a plan is resolvable (always — config carries
a default); the Blob is only a legacy no-plan fallback. So the customer PDF always
carries the payment terms now.

The עסקאות (deals) tab shows, per product in each closed deal: an inline preview
of that customer PDF (`?stream=1`, fresh render) PLUS the full "פירוט מלא לבוס"
breakdown — the sent quote and the internal numbers side by side.

## Negotiation buffer — "מרווח מיקוח" (built 2026-08-03)

Settings knob (רווחיות ועמלות section) `negotiationBufferAgorot` — X **agorot per
bag** added to EVERY customer per-bag price as room to discount while haggling and
still hit target. **Global** (Eli: "בוט כן") — applies to the bot auto-quote, the
manual calculator, AND factory-finalized quotes. Added to the per-bag price BEFORE
the round-up (`ceilAgorot`) in BOTH pricing engines
([lib/factory/calculator/engine.ts] via `adminSettings.negotiationBufferAgorot` +
[lib/factory/pricing.ts] via `config.negotiationBufferAgorot`), so message/PDF/
invoice/totals all derive from it. It **flows into profit** (price − cost) like the
round-up gain. The boss breakdown (`buildBreakdownView` → `DetailedBreakdown`)
shows a labelled "מרווח מיקוח (N אג׳/שקית) = ₪Y" line, threaded via
`negotiationBufferPerUnitIls` on QuoteResult / FactoryPricingResult / BreakdownInput.
0 = off. **Stacks** with the older mold padding (¥500/color). See memory
[[negotiation-buffer]].

## Send quotes WITH or WITHOUT payment terms (built 2026-08-03)

Eli confirms payment terms per-call and doesn't want them auto-attached. A quote
can now be sent with or without the payment block:
- **Sentinel** `NO_PAYMENT_PLAN_ID = "none"` + `resolveEffectivePlanId(explicit, cfg.paymentTerms)`
  in [payment-terms.ts] — explicit `"none"` → null (no terms); explicit id → that id;
  no pick → the settings default ONLY when `paymentTerms.includeByDefault` is on.
  **Default OFF** — a quote goes out clean unless a plan is chosen.
- **Every manual builder** gates its payment block on the resolved plan and reverts
  its header to a plain `*הצעת מחיר*` when omitted: `sendWhatsapp`, `sendCombinedWhatsapp`,
  `sendEstimateToCustomer`, the calculator caption ([CalculatorView]), and the single +
  combined PDF routes (`/api/factory/[id]/pdf`, `/api/factory/combine/pdf`).
- **Picker** ([CalculatorView] `PaymentPlanPicker`) gains "⛔ ללא תנאי תשלום" and
  defaults to it. **Settings** toggle "צרף תנאי תשלום להצעות כברירת מחדל"
  (`paymentTerms.includeByDefault`, persisted).
- **The bot is UNCHANGED** — `buildQuoteMessage` never sends payment terms, independent
  of this setting (a cold lead must not get bank details).
- Deals keep THEIR own stored terms (`row.paymentPlan`) on an ad-hoc PDF view —
  the "off" default only governs fresh manual sends.
- **Rule:** any hand-built engine/send path that attaches payment MUST route the plan
  through `resolveEffectivePlanId`. See memory [[payment-details-template]].
