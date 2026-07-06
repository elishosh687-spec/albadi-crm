/**
 * Client-safe catalog dimensions, for matching a free-form request spec to a
 * known catalog SKU. Mirrors `DEFAULT_CONFIG.products` in
 * [calculator/constants.ts] (id + dimensions + description only) — kept separate
 * so client components can detect "this is a catalog product" without importing
 * the server-side calculator config (which pulls sea-carrier data etc.).
 *
 * ⚠️ If the catalog product set changes in constants.ts, update this list too.
 * Verified against constants.ts on 2026-07-06.
 */

export interface CatalogDim {
  id: string;
  description: string;
  h: number;
  d: number; // 0 = flat bag
  w: number;
}

export const CATALOG_DIMS: CatalogDim[] = [
  { id: "p1", description: "מתאים לקוסמטיקה, תכשיטים, אקססוריז", h: 20, d: 8, w: 25 },
  { id: "p2", description: "מתאים לביגוד קל, מתנות", h: 30, d: 10, w: 30 },
  { id: "p3", description: "מתאים לנעליים, ביגוד, קופסאות", h: 30, d: 12, w: 40 },
  { id: "p4", description: "מתאים לפריטים גדולים", h: 40, d: 15, w: 50 },
  { id: "p5", description: "מתאים לפריטים רחבים", h: 30, d: 0, w: 40 },
  { id: "p6", description: "מתאים לפריטים קטנים", h: 15, d: 0, w: 20 },
  { id: "p7", description: "תיק קטן צר — מתאים למוצרי יוקרה", h: 15, d: 5, w: 20 },
  { id: "p8", description: "תיק בינוני-גדול — מתאים לביגוד וקופסאות", h: 35, d: 10, w: 40 },
  { id: "p9", description: "תיק גדול — מתאים לאריזות מתנה גדולות", h: 40, d: 15, w: 45 },
  { id: "p12", description: "תיק קטן — מתאים לאקססוריז", h: 10, d: 0, w: 15 },
  { id: "p13", description: "תיק ריבועי — מתאים למוצרים מרובעים", h: 25, d: 0, w: 25 },
];

/** Find the catalog SKU whose H/D/W match the given dims (±0.5cm), or null. */
export function matchCatalogProduct(h: number, d: number, w: number): CatalogDim | null {
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return CATALOG_DIMS.find((p) => eq(p.h, h) && eq(p.d, d) && eq(p.w, w)) ?? null;
}
