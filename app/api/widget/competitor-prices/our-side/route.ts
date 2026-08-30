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
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { competitorPrices } from "@/drizzle/schema";
import { getFactoryConfig } from "@/lib/factory/config";
import { catalogQuoteForProduct } from "@/lib/factory/server/catalog-quote";
import { estimateQuoteForSpec } from "@/lib/factory/server/estimate-quote";
import { matchCatalogProduct } from "@/lib/factory/catalog-dims";

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
  leadDays: number | null;
  source: "calculator" | "estimator" | null;
  /** Present when we deliberately have no number. */
  refused?: string;
}

export async function GET(req: NextRequest) {
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
      if (!dims) {
        out.push({ id: row.id, unitIls: null, leadDays: null, source: null, refused: "אין מידה" });
        continue;
      }

      const key = `${dims.h}/${dims.d}/${dims.w}/${qty}/${colors}/${marginOverride ?? "def"}`;
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
            hasHandles: true,
            shippingOptionId: SHIPPING,
            marginOverride,
          });
          res = q
            ? {
                id: row.id,
                unitIls: q.sellingPricePerUnitIls ?? null,
                leadDays: q.shippingOption?.deliveryDays ?? null,
                source: "calculator",
              }
            : { id: row.id, unitIls: null, leadDays: null, source: null, refused: "החישוב נכשל" };
        } else {
          const q = await estimateQuoteForSpec({
            spec: {
              heightCm: dims.h,
              depthCm: dims.d,
              widthCm: dims.w,
              quantity: qty,
              hasHandles: true,
              hasLamination: false,
              logoColors: colors,
            },
            shippingOptionId: SHIPPING,
            marginOverride,
          });
          res =
            q.ok && q.result
              ? {
                  id: row.id,
                  unitIls: q.result.sellingPricePerUnitIls ?? null,
                  leadDays: q.result.shippingOption?.deliveryDays ?? null,
                  source: "estimator",
                }
              : {
                  id: row.id,
                  unitIls: null,
                  leadDays: null,
                  source: null,
                  refused: q.refused ?? q.estimate?.refused ?? "האומדן סירב",
                };
        }
      } catch (e) {
        res = {
          id: row.id,
          unitIls: null,
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
    console.error("[widget/competitor-prices/our-side] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}
