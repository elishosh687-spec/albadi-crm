---
paths:
  - "lib/feishu/**"
  - "lib/factory/**"
  - "app/api/factory/**"
  - "scripts/_reparse*"
---

# Feishu factory sheet & factory quotes
- The factory quote sheet is a live shared Feishu sheet; columns get inserted anytime, and parsers read by fixed integer index — one inserted column silently shifts and corrupts every field.
- Layout (row 5 = header): `A 联系人 · B 报价单号 · C date · D 图片 · E 描述 · F 类型 · G 材质及克重 · H 尺寸 · I logo印刷 · J 表面处理 · K(10) 数量 (IGNORED, echoes our qty) · L(11) unitCost · M(12) cartonQty · N/O/P(13-15) 长/宽/高 · Q(16) cbm · R(17) 重量KG · S(18) 供应商 · T(19) remark · U(20) unlabeled plate fee` (parser scans U then T).
- THREE readers must change together or a re-import re-corrupts: `parseFactoryResponseRow` (L..R + plate fee U), `readRow`/`readAllRows` fetch ranges (must reach U/20), `parseFactoryRequestRow` (material←G, size←H, printing←I, finishing←J, quantity←K; skip F) used by `import-from-feishu`.
- Write side: `buildFactoryRow` must emit `type` at F (`DEFAULT_FACTORY_TYPE`) and derive the end column from `values.length` — never a hardcoded range. Symptom: column K empty on new request rows, or sheet qty ≠ `product_spec.quantity`.
- Shift signature: FinalizeModal "נתוני מפעל" shows `⚠️ CBM לא תואם למידות` (cbm in the hundreds), unitCost in thousands, supplier a bare number. A shifted request spec puts a size string in `productSpec.printing` → logoColors "35" → plate fee explodes.
- Fix order: shift indices in all parsers + ranges + layout comments, push to prod FIRST (refresh crons / `/api/*/factory/refresh` / re-imports rerun the old parser and overwrite a DB reparse), then reparse.
- Response reparse (model: `scripts/_reparse-after-col-shift.ts`): relocate rows via `findRowByQuotationNo`, take fresh numerics wholesale (no COALESCE), keep only `platePerColorCny`; dry-run then `--go`.
- Request-side `productSpec`: NEVER blanket-rewrite from Feishu; repair only rows matching the corruption signature.
- `import-from-feishu.ts` existence checks must filter `deleted_at`, or a soft-deleted quote blocks its own re-import ("already exists").
- Shipping ids: calculator `s1`/`s2` vs factory config `air-express`/`sea-standard`; `resolveShippingOption` (`lib/factory/pricing.ts`) translates and falls back to sea with a warning — never to no shipping. Symptom: ₪0 shipping line.
- `refreshFromFeishu` skips `finalized` rows on purpose; `force-refresh.ts` updates `factory_response` only and never re-prices (`final_pricing` is what the customer was quoted).

Full detail: `docs/agent/feishu-factory.md` — read it before non-trivial changes here.
