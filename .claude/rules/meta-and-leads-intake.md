---
paths:
  - "lib/meta/**"
  - "lib/sheets/**"
  - "lib/leads/**"
  - "lib/ads/**"
  - "app/api/leads/**"
  - "app/api/admin/meta-*/**"
  - "app/api/cron/enrich-meta-attribution/**"
  - "app/widget/ads/**"
  - "lib/analysis/ad-performance.ts"
---

# Meta CAPI loop, FB lead forms, website leads

- Every Meta event is POSTed by `sendMetaCrmEvent` (`lib/meta/capi.ts`) — no GHL Workflow is involved; "fix it in the GHL workflow" is wrong advice.
- Attribution key is the Meta leadgen id, found only in the Instant-Form Google Sheets; `enrichMetaAttribution` (`lib/sheets/meta-attribution.ts`) fills `leads.meta_*` and must match on phone, `wa_jid` AND sid (a lead's `phone_e164` may differ from the form's).
- `sendMetaCrmEvent` attributes by leadgen id OR website `fbc` (`fb.1.<createdAtMs>.<fbclid>`) + `fbp`. `pollGoodLeads` must use the same rule — filtering on `meta_leadgen_id IS NOT NULL` silently dropped every website good lead.
- `Qualified` = Eli's "good lead" tag in GHL (aliases `good lead`/`ליד טוב`/`ליד_טוב`/`qualified`) — never derive it. `pollGoodLeads` (`lib/meta/good-lead-poll.ts`) sends once and stamps `leads.meta_qualified_sent_at`, inside the daily `/api/cron/enrich-meta-attribution`.
- `Purchase` value = `grandTotalExVat` (single → `memberDisplayTotalExVat`, combined → frozen combined total). Value-less Purchases are refused + logged — keep that.
- `event_id` is always `<sid>:<eventName>` so Meta dedups re-sends.
- The loop fails silently; the health strip (`lib/meta/health.ts`) must compare like populations (uses `pollGoodLeads({dry:true})`).
- `pingMetaDataset`: don't "improve" it into a plain dataset read — the CAPI token can't read dataset metadata ((#100) on a healthy pipe); only 190/10/200 mean rejected credentials.
- Never hand out the prod Neon string or a Meta token; website `fbclid`/`fbp` arrive via `/api/leads/website-import` (`WEBSITE_IMPORT_SECRET`).
- Ads tab revenue MUST come from `listClosedQuotes().grandTotalExVat`, not `final_pricing->>'totalSellingPrice'`. Insights join by `ad_id`, never by name; `META_ADS_TOKEN` must be a System User token.
- FB form sheets: one sheet per form; every id lives in `DEFAULT_SHEET_IDS` (env adds, doesn't replace); each must be "Anyone with link → Viewer" or it's silently skipped. Columns are resolved by header name (`lib/sheets/fb-form-columns.ts`) — never reintroduce fixed indices.
- `/api/leads/facebook-import`: phones stored without `+` (`digitsOnly()`), dedupe by `phoneE164 OR waJid`; existing lead → tag only, never re-sends OPENING.
- Website WhatsApp leads are recognised by prefill fragments in `lib/leads/website-origin.ts` — update them when site copy changes (nothing fails loudly). `lead_source` uses `COALESCE(…, 'website')` so earlier attribution wins; always write a `source_touches` row.

- Ad recommendations (`lib/ads/`): recommendation-only, never writes to Meta (architecture test). Join by `normalizeAdId` (`ag:` prefix), never by ad name; suitable lead = the configured `lead_tags` tag, not `meta_qualified_sent_at`.

Full detail: `docs/agent/meta-and-leads-intake.md` — read it before non-trivial changes here.
