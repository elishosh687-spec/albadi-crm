/**
 * Peek at the factory-quote (SendToFactory) response sheet — read the header
 * row and a few recent rows across A..Z. Check if any column past R holds
 * plate-fee-per-color that we're not currently pulling into
 * parseFactoryResponseRow (which stops at column R = 17).
 */
import { feishuFetch } from "@/lib/feishu/client";

async function main() {
  const token = process.env.FEISHU_SHEET_TOKEN;
  if (!token) throw new Error("FEISHU_SHEET_TOKEN not set");

  const meta = await feishuFetch<{
    data: { sheets: { sheet_id: string; title: string }[] };
  }>(`/open-apis/sheets/v3/spreadsheets/${token}/sheets/query`, { method: "GET" });
  console.log(`workbook = FEISHU_SHEET_TOKEN (factory-response sheet)`);
  for (const s of meta.data.sheets) console.log(" -", s.sheet_id, "→", s.title);

  const firstId = meta.data.sheets[0]?.sheet_id;
  if (!firstId) return;

  const vals = await feishuFetch<{
    data: { valueRange: { values: unknown[][] } };
  }>(
    `/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(
      `${firstId}!A1:Z8`
    )}`,
    { method: "GET" }
  );
  const rows = vals.data?.valueRange?.values ?? [];

  const txt = (cell: unknown): string => {
    if (cell == null) return "";
    if (typeof cell === "string") return cell.trim();
    if (typeof cell === "number") return String(cell);
    if (Array.isArray(cell))
      return cell
        .map((seg) =>
          seg && typeof seg === "object" && "text" in seg
            ? String((seg as { text: unknown }).text)
            : ""
        )
        .join("")
        .trim();
    if (typeof cell === "object" && "text" in (cell as object))
      return String((cell as { text: unknown }).text).trim();
    return "";
  };

  console.log("\nfirst 8 rows, A..Z:\n");
  for (let i = 0; i < rows.length; i++) {
    const flat = rows[i].map(txt);
    if (flat.every((c) => !c)) continue;
    console.log(`row ${i} (${flat.length} cols non-empty):`);
    for (let j = 0; j < flat.length; j++) {
      const letter = String.fromCharCode(65 + j);
      if (flat[j]) console.log(`  ${letter}(${j}): ${flat[j].slice(0, 60)}`);
    }
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
