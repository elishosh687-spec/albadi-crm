/**
 * Phase 5 — apply the REVIEWED ad review-state proposal
 * (scripts/data/ad-review-seed.json, produced by ad-review-seed-proposal.ts)
 * through the normal store, so every row gets its audit entries and reason.
 *
 *   npx tsx scripts/seed-ad-review-state.ts          # dry run: prints what would change
 *   npx tsx scripts/seed-ad-review-state.ts --go     # writes
 *
 * Refuses unless the file is marked reviewedByEli. Rows whose target already
 * matches are skipped, so re-running is a no-op.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getReviewState, setReviewState } from "@/lib/ads/review-state-store";
import type { ReviewStatePatch } from "@/lib/ads/review-state";

const FILE = "scripts/data/ad-review-seed.json";
const REASON = "רישום הסטטוס המאושר ב-meta-ads.md מ-18/09/2026 (אושר על ידי אלי)";

(async () => {
  const go = process.argv.includes("--go");
  const doc = JSON.parse(readFileSync(FILE, "utf8"));
  if (!doc.reviewedByEli) throw new Error(`${FILE} is not marked reviewedByEli — review it first`);
  let changed = 0;
  for (const r of doc.rows as { name: string; adId: string; approvedStatus: string; segment: string; role: string | null }[]) {
    const { state } = await getReviewState(r.adId);
    const patch: ReviewStatePatch = {};
    if ((state?.approvedStatus ?? "untested") !== r.approvedStatus) patch.approvedStatus = r.approvedStatus as never;
    if ((state?.segment ?? null) !== r.segment) patch.segment = r.segment as never;
    if ((state?.role ?? null) !== r.role) patch.role = r.role as never;
    if (Object.keys(patch).length === 0) continue;
    changed++;
    console.log(`${go ? "WRITE" : "would"} ${r.name} ${r.adId}`, patch);
    if (go) await setReviewState(r.adId, patch, { reason: REASON, actor: "seed:2026-09-18" });
  }
  console.log(`${changed} rows ${go ? "written" : "would change"} of ${doc.rows.length}`);
  if (go) writeFileSync(FILE, JSON.stringify({ ...doc, appliedAt: new Date().toISOString() }, null, 2) + "\n");
})();
