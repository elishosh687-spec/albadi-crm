/**
 * Raw SQL access for seeding and assertions in integration tests. Deliberately
 * NOT the app's drizzle client — the tests observe the database the way an
 * operator would, so a bug in the app's own query layer cannot hide itself.
 *
 * Every row a test creates carries a `test:ci-` sid or a `ci-` id so it is
 * recognisable, and each file cleans up after itself even though the branch is
 * thrown away — the same files run locally against a branch you may keep.
 */
import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);

/** Unique-per-run tag so two concurrent runs on one branch cannot collide. */
export const RUN_TAG = `${Date.now().toString(36)}${process.pid.toString(36)}`;
export const ciSid = (name: string) => `test:ci-${name}-${RUN_TAG}`;
export const ciId = (name: string) => `ci-${name}-${RUN_TAG}`;

/** Test phone numbers: a reserved-looking Israeli range nobody owns. */
export const ciPhone = (n: number) => `97250000${String(n).padStart(4, "0")}`;
export const ciChatId = (n: number) => `${ciPhone(n)}@c.us`;

/** Remove every trace of a lead across the tables that key on its sid. */
export async function purgeSid(sid: string): Promise<void> {
  const bySid = ["messages", "lead_tags", "source_touches", "crm_tasks", "lead_events", "setter_decisions", "bot_decision_log", "lead_analyses"];
  for (const t of bySid) {
    try {
      await sql(`DELETE FROM ${t} WHERE manychat_sub_id = $1`, [sid]);
    } catch {
      /* table may not exist on this branch — fine */
    }
  }
  try {
    await sql(`DELETE FROM bot_quotes WHERE lead_sid = $1`, [sid]);
  } catch {
    /* ditto */
  }
  await sql(`DELETE FROM leads WHERE manychat_sub_id = $1`, [sid]);
}

/** Leads whose sid or phone matches one of our test numbers. */
export async function leadsForPhone(phone: string): Promise<{ manychat_sub_id: string; lead_source: string | null }[]> {
  return (await sql(
    `SELECT manychat_sub_id, lead_source FROM leads
     WHERE phone_e164 = $1 OR manychat_sub_id LIKE $2`,
    [phone, `${phone}@%`],
  )) as { manychat_sub_id: string; lead_source: string | null }[];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
