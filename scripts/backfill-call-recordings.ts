/**
 * One-shot backfill: enumerate ALL conversations in the GHL location,
 * find every TYPE_CALL message in each, and insert into
 * `call_recording_imports`. Dedupes via the unique ghl_message_id index.
 *
 * After this runs, the existing `/api/bot/process-recordings` cron will
 * chew through the queue at MAX_PER_TICK_DOWNLOADS/tick.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-call-recordings.ts
 *
 * Idempotent: safe to re-run. Already-imported rows are skipped via unique
 * constraint violation; the script counts and reports them.
 */
import { db } from "../lib/db";
import { callRecordingImports, ghlOauthTokens } from "../drizzle/schema";
import { desc } from "drizzle-orm";

const GHL_BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

interface Conversation {
  id: string;
  contactId?: string;
  lastMessageDate?: number;
  dateAdded?: number;
}

interface CallMessage {
  id: string;
  conversationId?: string;
  contactId?: string;
  type?: number | string;
  meta?: {
    call?: {
      status?: string;
      duration?: number;
      recordingUrl?: string;
    };
  };
  dateAdded?: string;
  dateUpdated?: string;
}

async function main() {
  const tok = (
    await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1)
  )[0];
  if (!tok) throw new Error("No ghl_oauth_tokens in DB");
  const locationId = tok.locationId;
  const auth = { Authorization: `Bearer ${tok.accessToken}`, Version: API_VERSION, Accept: "application/json" };

  console.log(`Backfilling call recordings for location ${locationId}\n`);

  // === Phase 1: enumerate ALL conversations ===
  const allConvos: Conversation[] = [];
  let cursor: number | undefined = undefined;
  let page = 0;
  while (true) {
    page++;
    const url =
      `${GHL_BASE}/conversations/search?locationId=${locationId}&limit=100` +
      `&sort=desc&sortBy=last_message_date` +
      (cursor ? `&startAfterDate=${cursor}` : "");
    const r = await fetch(url, { headers: auth });
    if (!r.ok) {
      console.error(`page ${page} → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      break;
    }
    const j: any = await r.json();
    const batch: Conversation[] = j.conversations ?? [];
    allConvos.push(...batch);
    process.stdout.write(`  page ${page}: +${batch.length} (total ${allConvos.length}/${j.total ?? "?"})\n`);
    if (batch.length < 100) break;
    cursor = batch[batch.length - 1].lastMessageDate;
    if (!cursor) break;
    if (page > 100) {
      console.warn("safety brake: stopping after 100 pages");
      break;
    }
  }
  console.log(`\nEnumerated ${allConvos.length} conversations.\n`);

  // === Phase 2: walk each conversation, collect call-type messages ===
  let totalCalls = 0;
  let newlyInserted = 0;
  let skippedDup = 0;
  let skippedNonCall = 0;
  let skippedConvErr = 0;

  for (let i = 0; i < allConvos.length; i++) {
    const conv = allConvos[i];
    const url = `${GHL_BASE}/conversations/${conv.id}/messages?limit=100`;
    const r = await fetch(url, { headers: auth });
    if (!r.ok) {
      skippedConvErr++;
      continue;
    }
    const j: any = await r.json();
    // Odd nesting: { messages: { messages: [...], lastMessageId, nextPage } }
    const messages: CallMessage[] = j.messages?.messages ?? [];
    let convCalls = 0;
    for (const m of messages) {
      const isCall =
        m.type === "TYPE_CALL" || m.type === 3 || m.type === "3" || !!m.meta?.call;
      if (!isCall) {
        skippedNonCall++;
        continue;
      }
      totalCalls++;
      convCalls++;
      try {
        await db.insert(callRecordingImports).values({
          ghlMessageId: m.id,
          ghlContactId: m.contactId ?? conv.contactId ?? "",
          ghlConversationId: m.conversationId ?? conv.id,
          callDurationSec: m.meta?.call?.duration ?? null,
          callStartedAt: m.dateAdded ? new Date(m.dateAdded) : null,
          recordingUrl: m.meta?.call?.recordingUrl ?? null,
          status: "pending",
        });
        newlyInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("duplicate") || msg.includes("unique")) {
          skippedDup++;
        } else {
          console.error(`  insert error for msg ${m.id}: ${msg.slice(0, 200)}`);
        }
      }
    }
    if ((i + 1) % 20 === 0 || i === allConvos.length - 1) {
      console.log(
        `  progress: ${i + 1}/${allConvos.length} convos · ${totalCalls} calls found · ${newlyInserted} new · ${skippedDup} dup`,
      );
    }
  }

  console.log(`\n=== Backfill summary ===`);
  console.log(`  conversations enumerated : ${allConvos.length}`);
  console.log(`  TYPE_CALL messages found : ${totalCalls}`);
  console.log(`  newly inserted           : ${newlyInserted}`);
  console.log(`  skipped (already in DB)  : ${skippedDup}`);
  console.log(`  skipped (non-call msgs)  : ${skippedNonCall}`);
  console.log(`  conversation fetch errors: ${skippedConvErr}`);
  console.log(`\nNext: the existing /api/bot/process-recordings cron will start chewing through the queue.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
