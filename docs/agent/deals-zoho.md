# Deals, Zoho Books, deliver hub

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

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

**Provider boundary (audited 2026-09-15).** The Studio still uses the preserved
Claude Agent SDK. Its media pipeline needs unattended command and network access;
the safe Codex profile used by the WhatsApp listener is intentionally read-only
and cannot replace it without weakening the sandbox. Do not remove this working
runtime or swap credentials merely to claim full migration.

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
`/Users/eli/Projects/marketing/albadi/content/customers/<customer>/`, (b) POSTs to the
deliver endpoint. Config `~/.claude/skills/albadi/.env` needs
`WIDGET_TOKEN` (=GHL_WIDGET_TOKEN) + optional `CRM_BASE`. Customer lookup uses
`/api/widget/leads/recent?q=` for the sid.

**zoho-invoice skill relocated to global** (`~/.claude/skills/zoho-invoice/`) from
the project-local `/Users/eli/Projects/zoho/.claude/skills/`. `zoho_import.py`
self-locates config/secrets/state via `__file__`, so it's relocatable; the
SKILL.md now says to `cd` into the skill dir first (its relative
`state/invoice_input.json` writes need it). Verified E2E locally (helper → Blob →
Feishu row + customer folder); WhatsApp `--send` is prod-only.
