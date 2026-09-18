/**
 * Phase 5 of the ad recommendations plan — PROPOSE the initial approved review
 * state from the registry in marketing/albadi/account/performance/meta-ads.md.
 *
 * The registry is by NAME, and one name is often several Meta ads (form +
 * WhatsApp copies, Advantage+ duplicates). Eli's rule (2026-09-18): an
 * approved status goes only to the copy that produced the results. This
 * script prints every name → its exact Ad IDs with spend/leads/deals and a
 * proposed status/segment/role per ID, and writes the proposal to
 * scripts/data/ad-review-seed.json for Eli to review. It writes nothing to the
 * database; scripts/seed-ad-review-state.ts applies the reviewed file.
 *
 * Needs META_ADS_TOKEN (read-only use) and DATABASE_URL.
 */
import { writeFileSync } from "node:fs";
import { fetchMetaEvidence } from "@/lib/ads/meta-evidence";
import { loadCrmEvidence } from "@/lib/ads/crm-evidence";
import { todayInIsrael } from "@/lib/ads/build-recommendations";
import { APPROVED_DEFAULTS_2026_09_18 as S } from "@/lib/ads/recommendation-settings";

const REGISTRY: Record<"winner" | "loser" | "testing", string[]> = {
  winner: ["07_chain_cut", "C-magic-hat-trick"],
  loser: ["concept-5-daylight-two-bags", "remarketing-quote-reminder"],
  testing: [
    "08_layers_peel", "03_banknote_tear", "09_knots_cut", "wild-03-food-chain", "bright-01-factory-line",
    "wild-01-matryoshka", "wild-07-coin-machine", "concept-3-story-dissolves", "bright-03-launch-day",
    "D-contract-stamp", "concept-4-launch-day", "Hub", "remarketing-02-your-date",
  ],
};
const CONTROLS = new Set(["07_chain_cut", "C-magic-hat-trick"]);

(async () => {
  const meta = await fetchMetaEvidence({ today: todayInIsrael(), fresh: true });
  if (!meta.ok) throw new Error(meta.reason);
  const crm = await loadCrmEvidence(S.suitableLead.tag);

  const out: {
    name: string; registry: string; adId: string; adSetName: string | null; campaignName: string | null;
    spendIls: number; metaLeads: number; deals: number;
    approvedStatus: "untested" | "testing" | "winner" | "loser"; segment: "prospecting" | "remarketing"; role: "control" | null;
  }[] = [];

  for (const [registry, names] of Object.entries(REGISTRY) as ["winner" | "loser" | "testing", string[]][]) {
    for (const name of names) {
      const copies = [...meta.ads.values()]
        .filter((a) => a.adName.trim() === name)
        .map((a) => ({
          a,
          spend: a.daily.reduce((s, d) => s + d.spendIls, 0),
          leads: a.daily.reduce((s, d) => s + d.metaLeads, 0),
          deals: crm.byAdId.get(a.adId)?.deals ?? 0,
        }))
        .sort((x, y) => y.deals - x.deals || y.spend - x.spend);
      if (copies.length === 0) {
        console.log(`⚠ ${name}: no Meta ad with this exact name`);
        continue;
      }
      copies.forEach((c, i) => {
        // The copy that produced the results carries the registry decision;
        // any other copy that delivered is "testing"; one that never spent stays untested.
        const status = i === 0 ? registry : c.spend > 0 ? "testing" : "untested";
        const remarketing = /רימרקטינג|remarketing/i.test(`${c.a.campaignName ?? ""} ${c.a.adSetName ?? ""} ${name}`);
        out.push({
          name, registry, adId: c.a.adId, adSetName: c.a.adSetName, campaignName: c.a.campaignName,
          spendIls: Math.round(c.spend * 100) / 100, metaLeads: c.leads, deals: c.deals,
          approvedStatus: status as never,
          segment: remarketing ? "remarketing" : "prospecting",
          role: i === 0 && CONTROLS.has(name) ? "control" : null,
        });
      });
    }
  }

  writeFileSync("scripts/data/ad-review-seed.json", JSON.stringify({ generatedAt: new Date().toISOString(), reviewedByEli: false, rows: out }, null, 2) + "\n");
  for (const r of out) {
    console.log([r.name.padEnd(28).slice(0, 28), r.adId, `₪${r.spendIls}`.padStart(9), `L${r.metaLeads}`.padStart(4), `D${r.deals}`, r.approvedStatus.padEnd(8), r.segment.padEnd(11), r.role ?? "-", (r.adSetName ?? "").slice(0, 40)].join(" | "));
  }
})();
