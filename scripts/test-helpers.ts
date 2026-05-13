/**
 * Shared helpers for scripts/test-stage{1,2,3,4}.ts and test-cadence.ts.
 *
 * Convention:
 *   - TEST_SID = "test:flow@test"  — synthetic JID, never collides with real
 *     bridge identifiers (those end @s.whatsapp.net or @lid).
 *   - All test scripts MUST set process.env.BRIDGE_DRY_RUN = "1" before
 *     importing any module that may call sendBridgeMessage / sendEliDM.
 *     The flag is checked at call time, so set it early in the script.
 *
 * Run:
 *   $env:BRIDGE_DRY_RUN = "1"
 *   npx tsx scripts/test-stage1.ts
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads, messages, bridgeEvents, leadTags } from "../drizzle/schema";
import { sql } from "drizzle-orm";

export const TEST_SID = "test:flow@test";
export const TEST_PHONE = "+972500000000";
export const TEST_NAME = "Test Lead";

export interface SeedOptions {
  stage?: string | null;
  qState?: Record<string, unknown> | null;
  followUpCount?: number;
  lastFollowUpAt?: Date | null;
  botPaused?: boolean;
  pipelineFlag?: string | null;
  quoteTotal?: string | null;
}

export async function wipeTestLead(): Promise<void> {
  const sid = TEST_SID;
  await db.execute(
    sql`DELETE FROM lead_tags WHERE manychat_sub_id = ${sid}`
  );
  await db.execute(
    sql`DELETE FROM messages WHERE manychat_sub_id = ${sid}`
  );
  await db.execute(
    sql`DELETE FROM bridge_events WHERE payload->'data'->>'chat_jid' = ${sid}`
  );
  await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id = ${sid}`);
}

export async function seedLead(opts: SeedOptions = {}): Promise<void> {
  await wipeTestLead();
  await db.insert(leads).values({
    manychatSubId: TEST_SID,
    waJid: TEST_SID,
    phoneE164: TEST_PHONE,
    name: TEST_NAME,
    source: "test",
    active: true,
    pipelineStage: opts.stage ?? null,
    qState: (opts.qState ?? null) as any,
    followUpCount: opts.followUpCount ?? 0,
    lastFollowUpAt: opts.lastFollowUpAt ?? null,
    botPaused: opts.botPaused ?? false,
    pipelineFlag: opts.pipelineFlag ?? null,
    quoteTotal: opts.quoteTotal ?? null,
  });
}

export interface LeadRow {
  sid: string;
  pipelineStage: string | null;
  pipelineFlag: string | null;
  botPaused: boolean;
  followUpCount: number;
  lastFollowUpAt: Date | null;
  qState: any;
  quoteTotal: string | null;
  botSummary: string | null;
}

export async function readLead(): Promise<LeadRow> {
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      lastFollowUpAt: leads.lastFollowUpAt,
      qState: leads.qState,
      quoteTotal: leads.quoteTotal,
      botSummary: leads.botSummary,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${TEST_SID}`)
    .limit(1);
  if (!row) {
    throw new Error(`Test lead ${TEST_SID} not found`);
  }
  return row as LeadRow;
}

export async function updateLastFollowUp(date: Date): Promise<void> {
  await db
    .update(leads)
    .set({ lastFollowUpAt: date, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${TEST_SID}`);
}

let passCount = 0;
let failCount = 0;

export function assert(cond: unknown, msg: string): void {
  if (cond) {
    passCount++;
    console.log(`  ✓ ${msg}`);
  } else {
    failCount++;
    console.log(`  ✗ ${msg}`);
  }
}

export function section(title: string): void {
  console.log(`\n— ${title} —`);
}

export async function finishAndExit(scriptName: string): Promise<never> {
  console.log(
    `\n${scriptName}: ${passCount} passed, ${failCount} failed` +
      (failCount === 0 ? " ✅" : " ❌")
  );
  await wipeTestLead();
  process.exit(failCount === 0 ? 0 : 1);
}

export function ensureDryRun(): void {
  if (process.env.BRIDGE_DRY_RUN !== "1") {
    console.error(
      "ERROR: BRIDGE_DRY_RUN env not set. Refusing to run — would send real WhatsApp messages."
    );
    console.error('Run with: $env:BRIDGE_DRY_RUN = "1"; npx tsx scripts/test-stageN.ts');
    process.exit(2);
  }
}

// Suppress unused-import warning for `bridgeEvents` and `leadTags` — kept so
// schema imports stay aligned with wipeTestLead's table list at a glance.
void bridgeEvents;
void leadTags;
void messages;
