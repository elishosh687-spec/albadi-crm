---
paths:
  - "lib/feishu/**"
  - "lib/factory/**"
  - "app/api/factory/**"
  - "scripts/_reparse*"
---

# Feishu factory sheet & factory-quote footguns

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

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
