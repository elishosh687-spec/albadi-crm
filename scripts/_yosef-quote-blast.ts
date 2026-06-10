/**
 * One-shot: create 4 factory quote requests for Yosef Hajaj.
 *
 * Each row carries one of the 4 captioned WhatsApp images he sent. Images
 * are uploaded to Vercel Blob (so the URL stays permanent — GreenAPI's
 * download URLs are temporary), then attached as the picUrl on the
 * factoryQuoteRequests row + the Feishu "pic" column.
 *
 * Defaults inferred from the last 5 prod requests:
 *   material  : "80g non-woven"
 *   printing  : "2 colors"
 *   finishing : "With handles / Not laminated"
 *   quantity  : "4000/8000"  (one row per size, label per Eli's call)
 */
import { db } from "../lib/db";
import { factoryQuoteRequests, messages } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { put } from "@vercel/blob";
import {
  appendRow,
  buildFactoryRow,
  setRowHeight,
  setCellDateFormat,
  FEISHU_ROW_HEIGHT_PX,
} from "../lib/feishu/sheets";

const SID = "972549477092@s.whatsapp.net";
const CUSTOMER_NAME = "יוסף חג׳ג׳";
const QUANTITY_LABEL = "4000/8000";

interface SpecRow {
  messageId: number;
  caption: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
}

// Mapping confirmed with the user; matches the captioned-image order.
const SPECS: SpecRow[] = [
  { messageId: 3061, caption: "24 רוחב 16 אורך 5 גובה", widthCm: 24, heightCm: 16, depthCm: 5 },
  { messageId: 3063, caption: "אןרך 22 רוחב 10", widthCm: 10, heightCm: 22, depthCm: 0 },
  { messageId: 3065, caption: "רוחב 45 אורך 36", widthCm: 45, heightCm: 36, depthCm: 0 },
  { messageId: 3068, caption: "אורך 16 רוחב 16 גובה 12", widthCm: 16, heightCm: 16, depthCm: 12 },
];

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function sizeLabel(s: SpecRow): string {
  const parts: string[] = [];
  if (s.heightCm) parts.push(`H${s.heightCm}`);
  if (s.depthCm) parts.push(`D${s.depthCm}`);
  if (s.widthCm) parts.push(`W${s.widthCm}`);
  return parts.join("*");
}

function describe(s: SpecRow): string {
  const flat = s.depthCm === 0;
  return `${s.widthCm}×${s.heightCm}${flat ? "" : `×${s.depthCm}`} ס״מ — מוצר מותאם`;
}

async function main() {
  console.log(`\n=== Yosef Hajaj quote blast — 4 rows ===\n`);

  // 1. Fetch the 4 messages with image payloads.
  const rows = await db
    .select()
    .from(messages)
    .where(inArray(messages.id, SPECS.map((s) => s.messageId)));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const spec of SPECS) {
    const msg = byId.get(spec.messageId);
    if (!msg) throw new Error(`message ${spec.messageId} not found in DB`);
    const payload: any = msg.payload;
    const downloadUrl: string =
      payload?.messageData?.fileMessageData?.downloadUrl;
    if (!downloadUrl) {
      throw new Error(`no downloadUrl on message ${spec.messageId}`);
    }
    const fileName: string =
      payload?.messageData?.fileMessageData?.fileName ?? `${spec.messageId}.jpg`;
    const mimeType: string =
      payload?.messageData?.fileMessageData?.mimeType ?? "image/jpeg";

    console.log(`\n— ${spec.caption}  (${sizeLabel(spec)})`);
    console.log(`  download: ${downloadUrl.slice(0, 80)}…`);

    // 2. Download bytes from GreenAPI.
    const dl = await fetch(downloadUrl);
    if (!dl.ok) throw new Error(`download HTTP ${dl.status} for ${spec.messageId}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    console.log(`  bytes: ${bytes.length}`);

    // 3. Upload to Vercel Blob.
    const blobPath = `factory-pics/yosef/${spec.widthCm}x${spec.heightCm}${spec.depthCm ? "x" + spec.depthCm : ""}-${shortId()}-${fileName}`;
    const blob = await put(blobPath, bytes, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
    });
    console.log(`  blob:  ${blob.url}`);

    // 4. Insert factory_quote_requests row. quantity is stored as a number
    //    on the productSpec JSON, but we tag the description with the
    //    "4000/8000" label so the operator UI also surfaces it.
    const id = `fq_${Date.now()}_${shortId()}`;
    const quotationNo = id.slice(-8).toUpperCase();
    const productSpec = {
      description: `${describe(spec)} (כמות ${QUANTITY_LABEL})`,
      material: "80g non-woven",
      widthCm: spec.widthCm,
      heightCm: spec.heightCm,
      depthCm: spec.depthCm,
      quantity: 4000, // base quantity; Feishu cell shows "4000/8000" label
      printing: "2 colors",
      finishing: "With handles / Not laminated",
      picUrl: blob.url,
      notes: `נשלח על ידי הלקוח בוואטסאפ. caption: "${spec.caption}". בקשה לכמויות 4000 ו-8000.`,
    };
    await db.insert(factoryQuoteRequests).values({
      id,
      manychatSubId: SID,
      quotationNo,
      productSpec,
      factoryStatus: "pending",
    });
    console.log(`  DB row: ${id}  quotationNo=${quotationNo}`);

    // 5. Append to Feishu — quantity column carries the label as a string.
    const feishuRowIndex = await appendRow(
      buildFactoryRow({
        customer: CUSTOMER_NAME,
        quotationNo,
        pic: blob.url,
        description: describe(spec),
        material: productSpec.material,
        size: sizeLabel(spec),
        printing: productSpec.printing,
        finishing: productSpec.finishing,
        quantity: QUANTITY_LABEL,
      }),
    );
    console.log(`  Feishu row: ${feishuRowIndex}`);

    // 6. Cosmetic touches (row height + date cell format).
    try {
      await setRowHeight(feishuRowIndex, FEISHU_ROW_HEIGHT_PX);
      await setCellDateFormat(feishuRowIndex, "C");
    } catch (e) {
      console.warn(`  cosmetic ops failed (non-fatal): ${e}`);
    }

    await db
      .update(factoryQuoteRequests)
      .set({ feishuRowIndex, updatedAt: new Date() })
      .where(eq(factoryQuoteRequests.id, id));
  }

  console.log(`\n✅ 4 rows in Feishu for ${CUSTOMER_NAME}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
