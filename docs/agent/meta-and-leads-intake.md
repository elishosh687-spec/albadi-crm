# Meta CAPI loop, FB lead forms, website leads

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

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

## Ad recommendations — "מודעות" tab (built 2026-09-18, redesigned same day)

Recommendation-only decision support per **exact Meta Ad ID**. Nothing in it can
activate, pause, edit or budget a Meta object — `tests/unit/architecture/ads-read-only.test.ts`
fails the build if a Graph write appears in `lib/ads/`, `app/api/widget/ads/`,
`components/ads/`. Design + plan: `docs/plans/2026-09-18-meta-ad-recommendations-*.md`.

- **Engine** `lib/ads/recommendation-engine.ts` (pure, client-safe): 13 codes,
  gates judged at the day cumulative spend CROSSED them (₪100 / ₪250 / ₪500),
  a CRM deal is judged before any CPL rule, missing/partial data never yields a
  winner or loser. Policy `lib/ads/recommendation-settings.ts` (validated,
  `.strict()`), stored in `app_config` `ads.recommendation.settings` +
  append-only `ad_recommendation_policy_revisions` (one CTE per save, revision PK
  = optimistic lock). Approved status per Ad ID: `ad_review_state` + `_audit`
  (migration 0004). A settings change never touches an approved status.
- **Evidence**: Meta daily insights (`lib/ads/meta-evidence.ts`, 90-day windows,
  every page, `action_type=lead` only — a WhatsApp-destination ad therefore
  shows 0 leads; there is none running since 08/06/2026). CRM by
  `normalizeAdId(meta_ad_id)` — the sheet stores `ag:<id>`, Meta returns bare
  digits; joining raw values matched nothing for months. Suitable lead = the
  `lead_tags` tag in the setting (`good lead`), NEVER `meta_qualified_sent_at`.
- **`META_ADS_TOKEN`** (Vercel prod) = System User "eli" in business
  `1041177089073457`, never expires; the system user holds the ad account
  (Manage campaigns) + the "Ads Automation" app only.
- **Health**: one status line on every sub-tab (`lib/ads/ads-health.ts`); the
  daily `ads-evidence` job (`/api/cron/ads-evidence-check`, 06:30 UTC) throws the
  Hebrew reason on a broken Meta/CRM read, so the watchdog WhatsApps Eli.
- **Purchase retry**: `lib/meta/purchase-retry.ts` inside the daily
  enrich-meta-attribution job resends a Purchase that FAILED at "סגור עסקה"
  (סהר צור, 16/09, transient "fetch failed") — only with an attribution key,
  value > 0, closed ≤ 45 days.
- **Initial statuses** came from the registry in `marketing/albadi/account/performance/meta-ads.md`
  via `scripts/ad-review-seed-proposal.ts` → reviewed `scripts/data/ad-review-seed.json`
  → `scripts/seed-ad-review-state.ts --go` (28 Ad IDs). A name's status goes
  only to the copy that produced the results (Eli, 18/09).
- UI shape is minimal on purpose (Eli): no filters, one collapsed row per ad.
- **Tab layout (ui-ux-pro-max redesign, 18/09):** `/widget/ads` default view =
  "לטיפול עכשיו" (failed health checks + purchases not `sent`/`not_from_meta`,
  then Meta-down / decision conflicts / structure warnings) → 4 KPIs with a
  "1 מכל N" meaning → one row per ad NAME from `buildAdPerformance`, enriched
  with the per-Ad-ID recommendation via `row.adIds` (`lib/ads/overview.ts`,
  joined by `normalizeAdId`, never by name; several copies → the highest-spend
  copy's pill). `?view=meta` = "מה עבר למטא" + connection health. The policy
  editor moved to the settings tab (`?tab=settings&section=ads`);
  `?view=settings` still renders it for old links. Old `recommendations` /
  `report` values land on the default view.

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
