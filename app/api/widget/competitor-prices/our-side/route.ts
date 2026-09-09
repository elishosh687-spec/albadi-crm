/**
 * GET /api/widget/competitor-prices/our-side?margin=<pct>
 *
 * What WE would charge for every spec the competitor table holds, at the same
 * quantity, so the "מחיר מתחרים" tab can put our number beside theirs — and
 * re-price the whole column live when Eli drags the margin.
 *
 * One request prices every row. The alternative was one HTTP call per row from
 * the browser (14 today, more later) repeated on every margin change.
 *
 * Each row says where its number came from, because they do not carry the same
 * confidence and a comparison that hides the difference is misleading:
 *   calculator — the size is a catalog SKU, priced by the exact engine
 *   estimator  — no SKU, priced by the fitted per-factory model
 *   refused    — the estimator declined (flat/odd shapes: shipping can't be
 *                estimated reliably), so there is no honest number to show
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN> (or Bearer).
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { competitorPrices } from "@/drizzle/schema";
import { getFactoryConfig } from "@/lib/factory/config";
import { catalogQuoteForProduct } from "@/lib/factory/server/catalog-quote";
import { estimateQuoteForSpec } from "@/lib/factory/server/estimate-quote";
import { matchCatalogProduct } from "@/lib/factory/catalog-dims";
import { moldsCostCnyFor } from "@/lib/factory/molds";
import { nearestCatalogSize } from "@/lib/factory/nearest-size";
import { validateBagGeometry } from "@/lib/factory/bag-geometry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sea throughout — every competitor here quotes local production or sea from
 * China, so an air price would not be comparable.
 *
 * ⚠️ "s2", NOT "sea-standard". Two id namespaces exist: the calculator engine
 * uses s1/s2, the factory config uses air-express/sea-standard. Passing the
 * factory id here does not error — the engine simply finds no matching option
 * and charges ZERO shipping, which quietly made our side look ~40% cheaper
 * than it is. Same trap CLAUDE.md records under "Factory quote — two more
 * footguns fixed 2026-08-11".
 */
const SHIPPING = "s2";

function auth(req: NextRequest): boolean {
  const token =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  return verifyWidgetToken(token);
}

/**
 * "30×40" → flat H30 W40. "23×6×36" → H23 D6 W36.
 * Accepts ×, x, *, and stray spaces — the field is free text.
 */
export function parseSize(
  size: string | null,
): { h: number; d: number; w: number } | null {
  if (!size) return null;
  const n = size
    .split(/[×x*]/i)
    .map((p) => parseFloat(p.replace(/[^\d.]/g, "")))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (n.length === 2) return { h: n[0], d: 0, w: n[1] };
  if (n.length === 3) return { h: n[0], d: n[1], w: n[2] };
  return null;
}

export interface OurSideRow {
  id: number;
  unitIls: number | null;
  /**
   * Our printing plates for this row — ¥1,000 per colour, once per order.
   *
   * Apples to apples means the plates too. חביב quotes a per-unit price with
   * the plate already inside it; גאלרי באג quotes ₪500 per colour on top; our
   * per-unit price carries neither. Comparing the three unit prices alone
   * compares three different things.
   */
  moldsIls: number | null;
  /** unit × quantity + plates — what the order actually costs, both sides. */
  totalIls: number | null;
  leadDays: number | null;
  source: "calculator" | "estimator" | "proxy" | null;
  /**
   * For a "proxy" price: the catalogue size it was actually taken from, and
   * how far that size is from the one asked about. Never render the number
   * without it — a price for a different bag has to say so.
   */
  proxyLabel?: string;
  proxyAreaPct?: number;
  proxyVolPct?: number;
  /** Present when we deliberately have no number. */
  refused?: string;
}


/**
 * Last resort: price the nearest catalogue size instead, clearly labelled.
 *
 * Only when the estimator has refused — it is fitted on the real thing and
 * beats a lookalike whenever it will answer — and only when our factory can
 * actually make the bag that was asked about. Quoting a proxy for a shape the
 * machines cannot produce would be a price for a bag that will never exist.
 */
async function proxyQuote(
  id: number,
  dims: { h: number; d: number; w: number },
  qty: number,
  colors: number,
  hasHandles: boolean,
  hasLamination: boolean,
  marginOverride: number | null,
  refusal: string
): Promise<OurSideRow> {
  const none: OurSideRow = {
    id, unitIls: null, moldsIls: null, totalIls: null, leadDays: null, source: null, refused: refusal,
  };
  if (validateBagGeometry(dims.w, dims.d, dims.h).length > 0) return none;
  const near = nearestCatalogSize(dims.h, dims.d, dims.w);
  if (!near) return none;
  try {
    const q = await catalogQuoteForProduct({
      productId: near.productId,
      quantity: qty,
      logoColors: colors,
      hasHandles,
      hasLamination,
      shippingOptionId: SHIPPING,
      marginOverride,
      moldsCostCny: moldsCostCnyFor(colors),
    });
    if (!q) return none;
    return {
      id,
      unitIls: q.sellingPricePerUnitIls ?? null,
      moldsIls: q.moldsTotalSellingPriceIls ?? 0,
      totalIls: q.totalOrderPriceIls ?? null,
      leadDays: q.shippingOption?.deliveryDays ?? null,
      source: "proxy",
      proxyLabel: near.label,
      proxyAreaPct: near.areaPct,
      proxyVolPct: near.volPct,
    };
  } catch {
    return none;
  }
}

export const GET = withRequestLog("calculator", async (req: NextRequest, log) => {
  if (!auth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const marginRaw = req.nextUrl.searchParams.get("margin");
  const parsed = marginRaw !== null ? parseFloat(marginRaw) : NaN;
  const marginOverride =
    Number.isFinite(parsed) && parsed >= 0 && parsed < 100 ? parsed : null;

  try {
    const cfg = await getFactoryConfig({ fresh: true });
    const rows = await db.select().from(competitorPrices);

    // Same spec + quantity + margin always prices the same — compute once.
    const cache = new Map<string, OurSideRow>();
    const out: OurSideRow[] = [];

    for (const row of rows) {
      const dims = parseSize(row.size);
      const qty = row.quantity ?? 5000;
      const colors = row.logoColors ?? 1;
      // Match the competitor's SPEC, not a default one. A laminated quote
      // priced against our un-laminated bag is not a comparison — and the
      // fields are free text, so "בלי" is the only reliable negative.
      const lamination = (row.lamination ?? "").trim();
      const hasLamination = !!lamination && !/^בלי|^ללא|^none/i.test(lamination);
      const handlesText = (row.handles ?? "").trim();
      const hasHandles = !handlesText || !/^בלי|^ללא|^none/i.test(handlesText);
      if (!dims) {
        out.push({ id: row.id, unitIls: null, moldsIls: null, totalIls: null, leadDays: null, source: null, refused: "אין מידה" });
        continue;
      }

      const key = `${dims.h}/${dims.d}/${dims.w}/${qty}/${colors}/${hasLamination}/${hasHandles}/${marginOverride ?? "def"}`;
      const hit = cache.get(key);
      if (hit) {
        out.push({ ...hit, id: row.id });
        continue;
      }

      let res: OurSideRow;
      const catalog = matchCatalogProduct(dims.h, dims.d, dims.w);
      try {
        if (catalog) {
          const q = await catalogQuoteForProduct({
            productId: catalog.id,
            quantity: qty,
            logoColors: colors,
            hasHandles,
            hasLamination,
            shippingOptionId: SHIPPING,
            marginOverride,
            moldsCostCny: moldsCostCnyFor(colors),
          });
          res = q
            ? {
                id: row.id,
                unitIls: q.sellingPricePerUnitIls ?? null,
                moldsIls: q.moldsTotalSellingPriceIls ?? 0,
                totalIls: q.totalOrderPriceIls ?? null,
                leadDays: q.shippingOption?.deliveryDays ?? null,
                source: "calculator",
              }
            : { id: row.id, unitIls: null, moldsIls: null, totalIls: null, leadDays: null, source: null, refused: "החישוב נכשל" };
        } else {
          const q = await estimateQuoteForSpec({
            spec: {
              heightCm: dims.h,
              depthCm: dims.d,
              widthCm: dims.w,
              quantity: qty,
              hasHandles,
              hasLamination,
              logoColors: colors,
            },
            shippingOptionId: SHIPPING,
            marginOverride,
            moldsCostCny: moldsCostCnyFor(colors),
          });
          res =
            q.ok && q.result
              ? {
                  id: row.id,
                  unitIls: q.result.sellingPricePerUnitIls ?? null,
                  moldsIls: q.result.moldsTotalSellingPriceIls ?? 0,
                  totalIls: q.result.totalOrderPriceIls ?? null,
                  leadDays: q.result.shippingOption?.deliveryDays ?? null,
                  source: "estimator",
                }
              : await proxyQuote(row.id, dims, qty, colors, hasHandles, hasLamination, marginOverride,
                  q.refused ?? q.estimate?.refused ?? "האומדן סירב");
        }
      } catch (e) {
        res = {
          id: row.id,
          unitIls: null,
          moldsIls: null,
          totalIls: null,
          leadDays: null,
          source: null,
          refused: e instanceof Error ? e.message : "שגיאה",
        };
      }

      cache.set(key, res);
      out.push(res);
    }

    return NextResponse.json({
      ok: true,
      margin: marginOverride ?? cfg.defaultProfitMargin,
      defaultMargin: cfg.defaultProfitMargin,
      rows: out,
    });
  } catch (e) {
    log.error("competitor_prices.our_side_failed", e, { marginOverride });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
});
