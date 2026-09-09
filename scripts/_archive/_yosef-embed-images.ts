/**
 * Embed the 4 Yosef images directly into Feishu cells (column D rows 13-16).
 * The cells currently hold the Vercel Blob URL as plain text. This replaces
 * that with an actual embedded image using Feishu's values_image endpoint.
 *
 * Idempotent: re-running overwrites the cell.
 */
import { db } from "../lib/db";
import { factoryQuoteRequests } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { feishuFetch } from "../lib/feishu/client";
import { getSpreadsheetToken, getSheetId } from "../lib/feishu/sheets";

interface Target {
  quotationNo: string;  // matches Feishu column B; we also use it to locate the picUrl in DB
  feishuRow: string;
}

const TARGETS: Target[] = [
  { quotationNo: "EVLGTP1G", feishuRow: "13" },
  { quotationNo: "W4JY09PR", feishuRow: "14" },
  { quotationNo: "FIRBM6CX", feishuRow: "15" },
  { quotationNo: "54QSKM5F", feishuRow: "16" },
];

async function embedImage(rowIndex: string, imageBytes: Buffer, filename: string): Promise<void> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!D${rowIndex}:D${rowIndex}`;
  // Feishu's values_image endpoint expects the bytes as a JSON array of ints.
  // (Confirmed in API docs: the "image" field is a byte array, not base64.)
  await feishuFetch(
    `/open-apis/sheets/v2/spreadsheets/${token}/values_image`,
    {
      method: "POST",
      body: JSON.stringify({
        range,
        image: Array.from(imageBytes),
        name: filename,
      }),
    },
  );
}

async function main() {
  for (const t of TARGETS) {
    const [row] = await db
      .select()
      .from(factoryQuoteRequests)
      .where(eq(factoryQuoteRequests.quotationNo, t.quotationNo))
      .limit(1);
    if (!row) {
      console.log(`  ${t.quotationNo}: not found in DB, skipping`);
      continue;
    }
    const spec: any = row.productSpec;
    const picUrl: string = spec?.picUrl;
    if (!picUrl) {
      console.log(`  ${t.quotationNo}: no picUrl on the row, skipping`);
      continue;
    }
    const dl = await fetch(picUrl);
    if (!dl.ok) {
      console.log(`  ${t.quotationNo}: blob download HTTP ${dl.status}, skipping`);
      continue;
    }
    const bytes = Buffer.from(await dl.arrayBuffer());
    const filename = picUrl.split("/").pop() ?? `${t.quotationNo}.jpg`;
    console.log(`  ${t.quotationNo} → row ${t.feishuRow}, ${bytes.length} bytes (${filename})`);
    await embedImage(t.feishuRow, bytes, filename);
    console.log(`    ✓ embedded`);
  }
  console.log(`\n✅ All 4 images embedded in Feishu column D, rows 13-16.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
