import { readRow } from "@/lib/feishu/sheets";

async function main() {
  const rows = ["5", "22", "37", "38", "39", "40", "41"];
  for (const r of rows) {
    const cells = await readRow(r);
    console.log(`\n=== row ${r} ===`);
    cells.forEach((v, i) => {
      const col = String.fromCharCode(65 + i);
      const display = v === null ? "" : typeof v === "string" ? `"${v}"` : String(v);
      if (display) console.log(`  ${col}[${i}] = ${display}`);
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
