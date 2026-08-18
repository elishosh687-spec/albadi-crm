/**
 * E2E verification for the sales-request/drafts fixes (Eli 2026-07-23).
 * Hits the LOCAL dev server (localhost:3000, BRIDGE_DRY_RUN=1) + checks the DB.
 * Run: DATABASE_URL="$(neonctl ...)" npx tsx scripts/_verify-draft-flow.ts
 */
import { db } from "../lib/db";
import { factoryQuoteRequests } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const BASE = "http://localhost:3000";
const TOKEN = "devtoken";
const SID = "972556871295@s.whatsapp.net"; // "לירון TEST" — disposable
const u = (p: string) => `${BASE}${p}${p.includes("?") ? "&" : "?"}widget_token=${TOKEN}`;

const spec = {
  description: "שקית אל-ארוג לבדיקה",
  material: "80g non-woven",
  widthCm: 30, heightCm: 40, depthCm: 10, quantity: 5000,
  printing: "1 color", finishing: "With handles / Not laminated",
};

async function row(id: string) {
  const r = await db.select({
    id: factoryQuoteRequests.id,
    status: factoryQuoteRequests.factoryStatus,
    finalPricing: factoryQuoteRequests.finalPricing,
    sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
    deletedAt: factoryQuoteRequests.deletedAt,
  }).from(factoryQuoteRequests).where(eq(factoryQuoteRequests.id, id)).limit(1);
  return r[0];
}
async function countForSid() {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(factoryQuoteRequests).where(eq(factoryQuoteRequests.manychatSubId, SID));
  return r[0].n;
}
const ok = (c: boolean, m: string) => console.log(`${c ? "✅" : "❌"} ${m}`);

async function main() {
  let pass = true;
  const check = (c: boolean, m: string) => { ok(c, m); if (!c) pass = false; };

  // ---- Issue 1: sales form → spec-only draft (no price) ----
  const beforeCount = await countForSid();
  let res = await fetch(u("/api/widget/factory-requests"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manychatSubId: SID, customerName: "לירון TEST", productSpec: spec }),
  });
  let j = await res.json();
  check(res.ok && j.ok && !!j.id, `[1] factory-request created (id=${j.id})`);
  const id = j.id as string;
  let r = await row(id);
  check(r?.status === "draft", `[1] status=draft (${r?.status})`);
  check(r?.finalPricing == null, `[1] finalPricing is NULL (spec-only) → ${JSON.stringify(r?.finalPricing)}`);

  // ---- Issue 3: recalc updates SAME draft in place ----
  const priceSnap = { unitSellingPrice: 3.5, totalSellingPrice: 17500, totalOrderPriceIls: 17500, totalProfit: 5000, profitMarginPct: 30, quantity: 5000, totalCbm: 2.1, totalShipping: 1200 };
  res = await fetch(u("/api/widget/factory/quote-draft"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manychatSubId: SID, productSpec: spec, finalPricing: priceSnap, draftId: id }),
  });
  j = await res.json();
  check(res.ok && j.ok && j.updated === true && j.id === id, `[3] quote-draft updated in place (updated=${j.updated}, id=${j.id})`);
  const afterRecalcCount = await countForSid();
  check(afterRecalcCount === beforeCount + 1, `[3] no NEW row created (count ${beforeCount}→${afterRecalcCount}, expected +1 from the request)`);
  r = await row(id);
  check(r?.finalPricing != null, `[3] draft now carries finalPricing`);

  // ---- Issue 4: estimator send stamps sentToCustomerAt ----
  res = await fetch(u("/api/widget/factory/estimate/send-customer"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sid: SID, customerName: "לירון TEST", widthCm: 30, heightCm: 40, depthCm: 10, qty: 5000, colors: 1, handles: true, lamination: false, shipping: "s2", draftId: id }),
  });
  j = await res.json();
  check(res.ok && j.ok, `[4] estimate send-customer ok (dry-run, status=${j.status})`);
  r = await row(id);
  check(r?.sentToCustomerAt != null, `[4] draft sentToCustomerAt stamped → ${r?.sentToCustomerAt}`);

  // ---- Issue 2: soft delete → recycle bin → restore ----
  res = await fetch(u(`/api/widget/factory/${id}`), { method: "DELETE" });
  j = await res.json();
  check(res.ok && j.ok, `[2] soft-delete ok`);
  r = await row(id);
  check(r?.deletedAt != null, `[2] deletedAt stamped → ${r?.deletedAt}`);
  // default list excludes it
  let list = await (await fetch(u("/api/widget/quotes/list?limit=500"))).json();
  check(!list.quotes.some((q: any) => q.id === id), `[2] hidden from default list`);
  // recycle-bin list includes it
  let bin = await (await fetch(u("/api/widget/quotes/list?deleted=1&limit=500"))).json();
  check(bin.quotes.some((q: any) => q.id === id), `[2] present in recycle bin (deleted=1)`);
  // restore
  res = await fetch(u(`/api/widget/factory/${id}/restore`), { method: "POST" });
  j = await res.json();
  check(res.ok && j.ok, `[2] restore ok`);
  r = await row(id);
  check(r?.deletedAt == null, `[2] deletedAt cleared after restore`);
  list = await (await fetch(u("/api/widget/quotes/list?limit=500"))).json();
  check(list.quotes.some((q: any) => q.id === id), `[2] back in default list after restore`);

  // ---- Cleanup: hard-delete the test row ----
  res = await fetch(u(`/api/widget/factory/${id}?hard=1`), { method: "DELETE" });
  j = await res.json();
  check(res.ok && j.ok && j.hard === true, `[cleanup] hard-deleted test row`);
  r = await row(id);
  check(r == null, `[cleanup] row gone`);

  console.log(pass ? "\n🎉 ALL CHECKS PASSED" : "\n💥 SOME CHECKS FAILED");
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
