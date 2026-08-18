import { getSpreadsheetToken, getSheetId } from "@/lib/feishu/sheets";
import { feishuFetch } from "@/lib/feishu/client";

async function readWide(rowIndex: string): Promise<(string | number | null)[]> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!A${rowIndex}:Z${rowIndex}`;
  const resp = await feishuFetch<{
    data: { valueRange: { values: (string | number | null)[][] } };
  }>(
    `/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  return resp.data?.valueRange?.values?.[0] ?? [];
}

function plain(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    return v
      .map((s) => (s && typeof s === "object" && "text" in s ? (s as any).text : ""))
      .join("");
  }
  return String(v);
}

async function main() {
  const rows = ["5", "22", "37", "38", "39", "20", "23"];
  for (const r of rows) {
    const cells = await readWide(r);
    console.log(`\n=== row ${r} ===`);
    cells.forEach((v, i) => {
      const col = String.fromCharCode(65 + i);
      const d = plain(v).trim();
      if (d) console.log(`  ${col}[${i}] = ${JSON.stringify(d.slice(0, 80))}`);
    });
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
