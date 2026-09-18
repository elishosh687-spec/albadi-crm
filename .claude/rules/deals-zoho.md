---
paths:
  - "lib/zoho/**"
  - "lib/factory/server/**"
  - "app/api/widget/factory/**"
  - "app/api/widget/zoho/**"
  - "app/api/widget/albadi/**"
  - "app/api/widget/deals/**"
  - "components/factory-flow/**"
  - "lib/feishu/order-follow.ts"
  - "scripts/deal-file.ts"
---

# Deals, Zoho Books, deliver hub
- Deal membership lives in `listClosedQuotes` (`lib/factory/server/closed.ts`): `closed_deal_at` set OR finalized + lead `WON`. New `factory_quote_requests` columns go in by direct DDL (`drizzle-kit push` hangs).
- Combined deal price = the combined offer frozen at close (`closeDealGroup` → `buildCombinedPricing` → `combined_pricing` on the PRIMARY), NEVER the sum of members; only snapshot-less legacy groups use `combineMembers`.
- `grandTotalExVat` is the canonical customer total — card, actuals defaults, invoice modal, Zoho lines and `/api/widget/deals` read it, never recompute. `deal_addons` go INSIDE it; `productsTotalExVat` is pre-addon.
- Deal-level fields (actuals, milestones, invoice, addons) live on the PRIMARY (oldest) member; deal id = primary id; `dealMemberIds` for the multi-line invoice.
- `removeDeal` can't hide a still-`WON` lead (`stillWon`); it must be moved off WON in GHL.
- `mirrorDealEventToGhl` is non-fatal and a no-op without `ghl_contact_id`.
- Accuracy strips compare factory COST (`unitCost`), not selling price; units are "CBM", never m³.
- `sendDealUpdate.ts` always previews (`?dry=1`) and confirms; sends as `sender='eli'` (pauses the bot). The original quote PDF stays as sent.
- Zoho: factory payments are EXPENSES on COGS (not bills); commissions EXPENSES on "עמלות מכירה"; invoices are INC-VAT (÷1.18 vs EX-VAT CRM totals); prefer `bcy_total`.
- API refuses foreign-currency expenses (`code 3048`): `createZohoExpense` converts ¥→₪ at the live rate, original in the description.
- `zohoConfigured()` false → soft-fail. Never apply the "הזמנה" reporting tag; consolidate via `customer_id`.
- Live invoice/expense writes hit real books (consecutive numbers): only with Eli's OK or create-then-delete on the test deal (`deleteZohoInvoice`/`deleteZohoExpense`).
- Zoho modals use a solid `#1b1917` panel, not `--lux-card` (near-transparent).
- Deliver hub `POST /api/widget/albadi/deliver`, ORDER FOLLOW columns: `factory_dieline`→X, `logo`→Y, `dieline`→Z; mockup/video/invoice have none. Mockups never append a row (`appendIfMissing=false`) and get no size lookup/local folder.
- `test:eli-demo` + TESTD1/TESTF1 are kept on purpose.
- Mockup/dieline generation stays local (`scripts/deal-file.ts`); don't remove the Studio's Claude Agent SDK runtime.

Full detail: `docs/agent/deals-zoho.md` — read it before non-trivial changes here.
