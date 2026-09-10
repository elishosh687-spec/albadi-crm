/**
 * Feishu "non-woven Quotation" sheet rows, A..U (indices 0..20), in the
 * layout verified 2026-08-11 (header row 5):
 *
 *   A(0) 联系人 · B(1) 报价单号 · C(2) date · D(3) 图片 · E(4) 描述 · F(5) 类型 ·
 *   G(6) 材质及克重 · H(7) 尺寸 · I(8) logo印刷 · J(9) 表面处理 · K(10) 数量 ·
 *   L(11) 人民币价格 · M(12) 装箱数量 · N(13) 长 · O(14) 宽 · P(15) 高 ·
 *   Q(16) 体积 · R(17) 重量KG · S(18) 供应商 · T(19) 备注 · U(20) unlabeled
 *
 * The rich-text cell (J) is what Feishu returns for a formatted cell — an
 * array of segments — so its type is wider than the parser's declared row
 * type. Cast once here so every test reads the shape the API really sends.
 */

export type FeishuRow = (string | number | null)[];

/** A Feishu rich-text segment, as returned for a formatted cell. */
export const RICH_FINISHING = [
  { segmentStyle: {}, text: "With handles / ", type: "text" },
  { segmentStyle: {}, text: "laminated", type: "text" },
];

export const GOLDEN_QUOTATION_NO = "ABC12345";

/** A fully answered row in the current layout. CBM (Q) left blank → derived. */
export const GOLDEN_ROW: FeishuRow = [
  "יוסי גולד",                      // A customer
  GOLDEN_QUOTATION_NO,              // B quotation no
  46245,                            // C date (Excel serial)
  "https://example.com/bag.png",    // D pic
  "Non-woven bag with handles",     // E description
  "Albadi non-woven bag",           // F type
  "80g non-woven",                  // G material
  "H20*D8*W25",                     // H size
  "3 color(s)",                     // I printing
  RICH_FINISHING as unknown as string, // J finishing (rich text)
  3000,                             // K quantity (echo of our request)
  "¥1.85",                          // L unit cost CNY
  500,                              // M carton qty
  60,                               // N length cm
  40,                               // O width cm
  55,                               // P height cm
  null,                             // Q cbm — absent, derived from N×O×P
  11,                               // R weight kg
  "MANDY",                          // S supplier
  "备注: sample by 9/20",            // T remark
  "printing cost: RMB350/COL",      // U plate fee (unlabeled)
];

/** Same row with the factory's own CBM filled in (Q). */
export const GOLDEN_ROW_WITH_CBM: FeishuRow = GOLDEN_ROW.map((c, i) =>
  i === 16 ? 0.132 : c
);

/** The plate fee written into 备注 (T) instead of the trailing column (U). */
export const PLATE_FEE_IN_T_ROW: FeishuRow = GOLDEN_ROW.map((c, i) => {
  if (i === 19) return "printing cost: RMB505/COL";
  if (i === 20) return null;
  return c;
});

/** A request we sent that the factory has not answered yet — L..U blank. */
export const UNANSWERED_ROW: FeishuRow = GOLDEN_ROW.map((c, i) =>
  i >= 11 ? null : c
);

/**
 * The 2026-07-02 corruption, reproduced one column further right: the factory
 * inserts a column at K, so every factory value lands one slot to the RIGHT of
 * where the parser reads it. The parser then sees:
 *   unitCost ← our quantity (5000) · cbm ← carton height (55) ·
 *   weight ← real cbm (0.15) · supplier ← real weight ("11")
 * Exactly the signature CLAUDE.md documents (ba1e88f).
 */
export const SHIFTED_ROW: FeishuRow = [
  "יוסי גולד",
  "SHIFT001",
  46245,
  "",
  "Non-woven bag with handles",
  "Albadi non-woven bag",
  "80g non-woven",
  "H20*D8*W25",
  "3 color(s)",
  "With handles / laminated",
  "",                               // K — the newly inserted column
  5000,                             // L ← 数量 (our qty) — read as unitCost
  1.85,                             // M ← real unit cost — read as cartonQty
  500,                              // N ← real carton qty — read as length
  60,                               // O ← real length — read as width
  40,                               // P ← real width — read as height
  55,                               // Q ← real height — read as cbm
  0.15,                             // R ← real cbm — read as weight
  11,                               // S ← real weight — read as supplier
  "MANDY",                          // T ← real supplier — read as notes
  "printing cost: RMB350/COL",      // U — plate fee
];
