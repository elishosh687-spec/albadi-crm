/**
 * Dump ONLY the GREEN (Mandy) catalog points from Feishu, raw prices.
 * READ-ONLY. Groups by size; shows base / handle / lam / colours per qty tier.
 */
import "dotenv/config";
import { extractFeishu, bagAreaCm2 } from "@/lib/factory/server/estimator-fit";

const TIERS = [3000, 5000, 10000];

async function main() {
  const { cat } = await extractFeishu();
  const green = cat.filter((p) => p.factory === "Mandy");
  console.log(`\n🟢 GREEN (Mandy) catalog — ${green.length} נקודות\n`);

  const sizes = [...new Set(green.map((p) => p.size))].sort();
  for (const size of sizes) {
    const pts = green.filter((p) => p.size === size);
    const area = pts[0] ? Math.round(pts[0].area) : 0;
    const is3D = /D\d/.test(size);
    console.log(`\n━━━ ${size}  (שטח ${area} ס״מ²${is3D ? " · 3D" : " · 2D"}) ━━━`);
    // base 1-color, non-lam, split handle
    for (const hasHandle of [false, true]) {
      for (const hasLam of [false, true]) {
        const label = `${hasHandle ? "ידית " : "בלי-ידית"} ${hasLam ? "· למינציה" : ""}`.trim();
        const cells = TIERS.map((q) => {
          const one = pts.find((p) => p.qty === q && p.hasHandle === hasHandle && p.hasLam === hasLam && p.colors === 1);
          return one ? `${q}=¥${one.price}` : `${q}=—`;
        });
        if (cells.some((c) => !c.endsWith("—"))) console.log(`   ${label.padEnd(20)} ${cells.join("  ")}`);
      }
    }
    // colours (non-lam, base handle variant)
    for (const cc of [2, 3]) {
      const cells = TIERS.map((q) => {
        const p = pts.find((x) => x.qty === q && !x.hasHandle && !x.hasLam && x.colors === cc);
        return p ? `${q}=¥${p.price}` : `${q}=—`;
      });
      if (cells.some((c) => !c.endsWith("—"))) console.log(`   ${cc} צבעים (בלי ידית)   ${cells.join("  ")}`);
    }
    const plate = pts.find((p) => p.plateFee != null)?.plateFee;
    if (plate != null) console.log(`   版费 גלופה/צבע: ¥${plate}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
