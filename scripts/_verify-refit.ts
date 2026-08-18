/** Dry-run the auto-refit (BRIDGE_DRY_RUN=1 → Eli DM is logged, not sent). */
import { refitEstimator } from "@/lib/factory/server/refit-estimator";
async function main() {
  const r = await refitEstimator();
  console.log(JSON.stringify(r, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
