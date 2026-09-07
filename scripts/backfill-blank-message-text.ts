/**
 * Re-extract `messages.text` for rows that were stored blank.
 *
 * WHY: until 2026-09-07 the webhook's text extractor was an allow-list and
 * returned null for every type it did not know. 1,064 of 11,010 rows (9.7%)
 * were stored with no text at all — including 248 of 248 `quotedMessage` rows,
 * which is how WhatsApp encodes any reply to an earlier message. The text was
 * never lost, only unread: it is still sitting in `messages.payload`.
 *
 * This script replays those payloads through the SAME extractor the webhook
 * now uses (lib/greenapi/extract-text.ts). Importing it rather than
 * re-implementing it is the point — two copies would drift and the "repair"
 * would write rows in a shape the live path no longer produces.
 *
 * Dry by default. `--go` to write.
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string \
 *     --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" \
 *     npx tsx scripts/backfill-blank-message-text.ts [--go]
 */
import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import {
  extractMessageText,
  type GreenMessageData,
} from "../lib/greenapi/extract-text";

interface Row {
  id: number;
  sid: string;
  sender: string | null;
  received_at: string;
  payload: unknown;
}

function messageDataOf(payload: unknown): GreenMessageData | null {
  if (!payload || typeof payload !== "object") return null;
  const md = (payload as Record<string, unknown>).messageData;
  return md && typeof md === "object" ? (md as GreenMessageData) : null;
}

async function main() {
  const apply = process.argv.includes("--go");

  const res = await db.execute(sql`
    SELECT id, manychat_sub_id AS sid, sender, received_at, payload
    FROM messages
    WHERE btrim(coalesce(text, '')) = ''
    ORDER BY received_at
  `);
  const rows = (res as unknown as { rows: Row[] }).rows ?? [];
  console.log(`blank rows found: ${rows.length}\n`);

  // A placeholder is a strictly better record than an empty bubble, but it is
  // NOT recovered text. Counting them together would overstate the repair.
  const recovered: Array<{ row: Row; text: string }> = [];
  const placeholder: Array<{ row: Row; text: string }> = [];
  const stillBlank: Row[] = [];
  const byType = new Map<
    string,
    { recovered: number; placeholder: number; blank: number }
  >();

  for (const row of rows) {
    const md = messageDataOf(row.payload);
    const type = md?.typeMessage ?? "(no typeMessage)";
    const bucket =
      byType.get(type) ?? { recovered: 0, placeholder: 0, blank: 0 };

    const { store, route } = extractMessageText(md);
    if (route) {
      recovered.push({ row, text: route });
      bucket.recovered++;
    } else if (store) {
      placeholder.push({ row, text: store });
      bucket.placeholder++;
    } else {
      stillBlank.push(row);
      bucket.blank++;
    }
    byType.set(type, bucket);
  }

  console.log("by message type:");
  console.log("  type                     real text   placeholder   still blank");
  for (const [type, b] of [...byType.entries()].sort(
    (a, c) => c[1].recovered - a[1].recovered,
  )) {
    console.log(
      `  ${type.padEnd(24)} ${String(b.recovered).padStart(9)} ` +
        `${String(b.placeholder).padStart(13)} ${String(b.blank).padStart(13)}`,
    );
  }

  console.log(
    `\nreal text recovered: ${recovered.length}` +
      `\nplaceholder only:    ${placeholder.length}` +
      `\nstill blank:         ${stillBlank.length}`,
  );

  console.log("\nsample of REAL customer text being restored (newest 12):");
  for (const { row, text } of recovered
    .filter((r) => r.row.sender === "lead")
    .slice(-12)) {
    const when = new Date(row.received_at).toISOString().slice(0, 16);
    const preview = text.replace(/\s+/g, " ").slice(0, 58);
    console.log(`  ${when}  ${row.sid.padEnd(30)} ${preview}`);
  }

  const toWrite = [...recovered, ...placeholder];
  if (!apply) {
    console.log(`\n[DRY] would update ${toWrite.length} rows. re-run with --go.`);
    process.exit(0);
  }

  let n = 0;
  for (const { row, text } of toWrite) {
    // text ONLY. payload, sender and received_at are the original record.
    await db.execute(sql`
      UPDATE messages SET text = ${text}
      WHERE id = ${row.id} AND btrim(coalesce(text, '')) = ''
    `);
    n++;
    if (n % 100 === 0) console.log(`  …${n}/${toWrite.length}`);
  }
  console.log(`\nupdated ${n} rows.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
