/**
 * lib/factory/server/closed.ts against a real database: the combined offer is
 * FROZEN at close (2026-07-31 rule — the customer pays the combined offer, not
 * the sum of the quotes), listClosedQuotes serves that frozen number as the
 * deal's one total, and "הסר מעסקאות" is reversible.
 *
 * Seeds its own lead + two priced quotes and deletes them afterwards. The Meta
 * Purchase event is stubbed — the only edge that leaves the system.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ciId, ciSid, purgeSid, sql } from "./_db";

const meta = vi.hoisted(() => ({ sendMetaCrmEvent: vi.fn(async () => ({ ok: false, skipped: "ci" })) }));
vi.mock("@/lib/meta/capi", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sendMetaCrmEvent: meta.sendMetaCrmEvent }));

import { closeDealGroup, listClosedQuotes, removeDeal, setDealClosed } from "@/lib/factory/server/closed";
import { getFactoryConfig } from "@/lib/factory/config";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult } from "@/lib/factory/types";

const SID = ciSid("deal");
const A = ciId("fqr-a");
const B = ciId("fqr-b");
let pricingA: FactoryPricingResult;
let pricingB: FactoryPricingResult;

async function seedQuote(id: string, quotationNo: string, pricing: FactoryPricingResult, createdAt: string) {
  await sql(
    `INSERT INTO factory_quote_requests (id, manychat_sub_id, quotation_no, created_at, updated_at, product_spec, factory_status, factory_response, final_pricing)
     VALUES ($1, $2, $3, $4::timestamptz, now(), $5::jsonb, 'finalized', $6::jsonb, $7::jsonb)`,
    [
      id, SID, quotationNo, createdAt,
      JSON.stringify({ description: "CI bag", material: "80g non-woven", widthCm: 35, heightCm: 40, depthCm: 10, quantity: pricing.quantity, printing: "2 colours", finishing: "none" }),
      JSON.stringify({ unitCostCny: 1.27, cartonQty: 200, cartonLengthCm: 48, cartonWidthCm: 41, cartonHeightCm: 45, cartonCbm: 0.0886, weightKg: 17, supplier: "CI" }),
      JSON.stringify(pricing),
    ],
  );
}

beforeAll(async () => {
  await purgeSid(SID);
  await sql(`DELETE FROM factory_quote_requests WHERE id IN ($1, $2)`, [A, B]);
  await sql(`INSERT INTO leads (manychat_sub_id, name, active, source, phone_e164) VALUES ($1, 'CI deal lead', true, 'ci', '972500009999')`, [SID]);

  const cfg = await getFactoryConfig({ fresh: true });
  const sea = cfg.shippingOptions.find((o) => o.type === "sea" && o.enabled) ?? cfg.shippingOptions[0];
  const carton = { qty: 200, weightKg: 17, lengthCm: 48, widthCm: 41, heightCm: 45 };
  pricingA = priceFactoryQuote({ factoryUnitCostCny: 1.27, quantity: 5000, shippingOptionId: sea.id, cartonSpec: carton, platePerColorCny: 530, logoColors: 2, moldsCostCny: 0 }, cfg);
  pricingB = priceFactoryQuote({ factoryUnitCostCny: 1.65, quantity: 3000, shippingOptionId: sea.id, cartonSpec: { ...carton, qty: 150, weightKg: 15 }, platePerColorCny: 530, logoColors: 1, moldsCostCny: 0 }, cfg);
  await seedQuote(A, "CI-A", pricingA, "2026-09-01T10:00:00Z");
  await seedQuote(B, "CI-B", pricingB, "2026-09-02T10:00:00Z");
});

afterAll(async () => {
  await sql(`DELETE FROM factory_quote_requests WHERE id IN ($1, $2)`, [A, B]);
  await purgeSid(SID);
});

async function row(id: string) {
  const r = (await sql(
    `SELECT closed_deal_at, deal_group_id, combined_pricing, deal_removed_at FROM factory_quote_requests WHERE id = $1`,
    [id],
  )) as { closed_deal_at: string | null; deal_group_id: string | null; combined_pricing: any; deal_removed_at: string | null }[];
  return r[0];
}
const ourDeals = async () => (await listClosedQuotes()).filter((d) => d.leadSid === SID || [A, B].includes(d.id));

describe("closeDealGroup — the combined offer is frozen", () => {
  it("groups both quotes, freezes combined_pricing on the primary, never above the standalone sum", async () => {
    const groupId = await closeDealGroup([B, A]);
    expect(groupId).toBe(`dg_${[A, B].sort()[0]}`);

    const a = await row(A), b = await row(B);
    expect(a.closed_deal_at).not.toBeNull();
    expect(b.closed_deal_at).not.toBeNull();
    expect(a.deal_group_id).toBe(groupId);
    expect(b.deal_group_id).toBe(groupId);

    // primary = oldest priced member = A
    expect(a.combined_pricing).not.toBeNull();
    expect(b.combined_pricing).toBeNull();
    const frozen = a.combined_pricing;
    expect(frozen.perProduct.map((p: { id: string }) => p.id).sort()).toEqual([A, B].sort());
    const standalone = (customerTotalExVat(pricingA) ?? 0) + (customerTotalExVat(pricingB) ?? 0);
    expect(frozen.grandTotalIls).toBeGreaterThan(0);
    expect(frozen.grandTotalIls).toBeLessThanOrEqual(standalone + 0.01);
    expect(frozen.shippingOptionId).toBeTruthy(); // never a ₪0-shipping freeze
  });

  it("listClosedQuotes shows ONE deal whose total is the frozen combined offer", async () => {
    const deals = await ourDeals();
    expect(deals).toHaveLength(1);
    const d = deals[0];
    expect(d.id).toBe(A);
    expect(d.products).toHaveLength(2);
    expect(d.grandTotalExVat).toBeCloseTo((await row(A)).combined_pricing.grandTotalIls, 2);
  });

  it("closing is idempotent — same group id, snapshot re-frozen, still one deal", async () => {
    const again = await closeDealGroup([A, B]);
    expect(again).toBe((await row(A)).deal_group_id);
    expect(await ourDeals()).toHaveLength(1);
  });
});

describe("removeDeal — reversible", () => {
  it("clears the close on every member, unbinds the group, drops the snapshot, hides the deal", async () => {
    const r = await removeDeal(A);
    expect(r.stillWon).toBe(false); // our lead is not WON
    for (const id of [A, B]) {
      const x = await row(id);
      expect(x.closed_deal_at).toBeNull();
      expect(x.deal_group_id).toBeNull();
      expect(x.combined_pricing).toBeNull();
      expect(x.deal_removed_at).not.toBeNull();
    }
    expect(await ourDeals()).toHaveLength(0);
  });

  it("setDealClosed brings a single quote back as its own deal at its own customer total", async () => {
    await setDealClosed(A, true);
    const x = await row(A);
    expect(x.closed_deal_at).not.toBeNull();
    expect(x.deal_removed_at).toBeNull(); // the tombstone is cleared by a re-close
    const deals = await ourDeals();
    expect(deals).toHaveLength(1);
    expect(deals[0].products).toHaveLength(1);
    expect(deals[0].grandTotalExVat).toBeCloseTo(customerTotalExVat(pricingA)!, 2);
  });
});
