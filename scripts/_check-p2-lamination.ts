/**
 * Pull p2 (H30*D10*W30) lamination prices from Feishu catalog and compare
 * to constants.ts. Diagnose whether the +¥0.04 5000-tier lamination addon
 * is a constants typo or matches Feishu.
 */
import { feishuFetch } from "@/lib/feishu/client";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const TARGET = "H30-D10-W30";

async function main() {
  const meta = await feishuFetch<{
    data: { sheets: { sheet_id: string; title: string }[] };
  }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });

  const tab = meta.data.sheets.find(
    (s) => s.title.replace(/\s/g, "").toUpperCase() === TARGET.toUpperCase()
  );
  if (!tab) {
    console.log("available tabs:", meta.data.sheets.map((s) => s.title));
    throw new Error(`tab ${TARGET} not found`);
  }
  console.log(`\nFound tab: "${tab.title}" (${tab.sheet_id})\n`);

  const vals = await feishuFetch<{
    data: { valueRange: { values: unknown[][] } };
  }>(
    `/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(
      `${tab.sheet_id}!A1:Z120`
    )}`,
    { method: "GET" }
  );

  const rows = vals.data?.valueRange?.values ?? [];

  // flatten rich-text cells to plain strings
  const txt = (cell: unknown): string => {
    if (cell == null) return "";
    if (typeof cell === "string") return cell.trim();
    if (typeof cell === "number") return String(cell);
    if (Array.isArray(cell))
      return cell
        .map((seg) => (seg && typeof seg === "object" && "text" in seg ? String((seg as { text: unknown }).text) : ""))
        .join("")
        .trim();
    if (typeof cell === "object" && "text" in (cell as object))
      return String((cell as { text: unknown }).text).trim();
    return "";
  };

  console.log("flattened rows (col-by-col):\n");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const flat = r.map(txt);
    if (flat.every((c) => !c)) continue;
    console.log(`row ${String(i).padStart(2)}: ${flat.slice(0, 12).map((c) => c.slice(0, 30)).join(" | ")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
