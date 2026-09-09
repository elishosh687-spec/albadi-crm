/**
 * Read the catalog-price tab the worker fixed (sheet=1jaRgg) from the Feishu
 * spreadsheet. Lists all tabs, then dumps the target tab's full grid so we can
 * see the corrected lamination prices. READ-ONLY.
 */
import { feishuFetch } from "@/lib/feishu/client";

const TOKEN = process.env.FEISHU_SHEET_TOKEN!;
const TARGET = process.env.TARGET_TAB || "1jaRgg";

async function main() {
  const meta = await feishuFetch<any>(
    `/open-apis/sheets/v3/spreadsheets/${TOKEN}/sheets/query`,
    { method: "GET" }
  );
  const sheets = (meta.data?.sheets ?? []).sort((a: any, b: any) => a.index - b.index);
  console.log("=== TABS ===");
  for (const s of sheets) console.log(`  ${s.sheet_id}  idx=${s.index}  "${s.title}"  rows=${s.grid_properties?.row_count ?? "?"} cols=${s.grid_properties?.column_count ?? "?"}`);

  console.log(`\n=== GRID of tab ${TARGET} (A1:Z80) ===`);
  const range = `${TARGET}!A1:Z80`;
  const resp = await feishuFetch<any>(
    `/open-apis/sheets/v2/spreadsheets/${TOKEN}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  const rows: any[][] = resp.data?.valueRange?.values ?? [];
  rows.forEach((r, i) => {
    const cells = r.map((c) => {
      if (Array.isArray(c)) return c.map((seg: any) => seg?.text ?? "").join("");
      return c ?? "";
    });
    if (cells.some((c) => c !== "")) console.log(`r${i + 1}: ${JSON.stringify(cells)}`);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
