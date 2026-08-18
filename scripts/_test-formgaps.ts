import { loadFormGapsVsDb } from "@/lib/sheets/lead-gaps";
async function main() {
  const snap = await loadFormGapsVsDb();
  console.log(`checked=${snap.checked} inSystem=${snap.inSystem} notInSystem=${snap.notInSystem.length}`);
  for (const g of snap.notInSystem) console.log(`  row ${g.rowIndex}: ${g.name} | ${g.phone} | sent="${g.sent}" | status="${g.status}"`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
