/**
 * Comprehensive lead-purge for Eli's test number (972525755705).
 * Scoped strictly to sid = '972525755705@c.us' — no other leads touched.
 *
 * GHL contact must be deleted manually from the GHL UI before/after
 * (contact_id: VLgMRMz8Ow68Rm2p0Jck, opp: QjkofFxc66AMAnTWoPBw); otherwise
 * the next GHL resync will recreate the DB row.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

const SID = "972525755705@c.us";

// Every table that references a lead by sid. Two columns names in use:
// most tables use `manychat_sub_id`, two use `lead_sid`.
const SID_TABLES: Array<{ name: string; col: string }> = [
  { name: "lead_tags", col: "manychat_sub_id" },
  { name: "messages", col: "manychat_sub_id" },
  { name: "bot_drafts", col: "manychat_sub_id" },
  { name: "lead_events", col: "manychat_sub_id" },
  { name: "factory_quote_requests", col: "manychat_sub_id" },
  { name: "bot_quotes", col: "lead_sid" },
  { name: "crm_lead_episodes", col: "manychat_sub_id" },
  { name: "crm_tasks", col: "manychat_sub_id" },
  { name: "ghl_lead_tasks", col: "lead_sid" },
  { name: "crm_sla_timers", col: "manychat_sub_id" },
  { name: "lead_score_snapshots", col: "manychat_sub_id" },
  { name: "source_touches", col: "manychat_sub_id" },
  { name: "opportunities", col: "manychat_sub_id" },
  { name: "consent_records", col: "manychat_sub_id" },
  { name: "bot_decision_log", col: "manychat_sub_id" },
];

async function main() {
  console.log(`\n=== Purging everything for sid='${SID}' ===\n`);

  // Step 1: confirm lead exists
  const leadCheck = await db.execute(
    sql`select manychat_sub_id, name, phone_e164 from leads where manychat_sub_id = ${SID}`,
  );
  // @ts-expect-error rows type varies by driver
  const leadRows = leadCheck.rows ?? leadCheck;
  if (!leadRows || leadRows.length === 0) {
    console.log("Lead row not found — nothing to purge.");
    return;
  }
  console.log(`Lead found: ${JSON.stringify(leadRows[0])}\n`);

  // Step 2: count + delete each child table
  for (const t of SID_TABLES) {
    const countRes = await db.execute(
      sql.raw(`select count(*)::int as c from ${t.name} where trim(${t.col}) = '${SID}'`),
    );
    // @ts-expect-error rows type
    const c = Number((countRes.rows ?? countRes)[0]?.c ?? 0);
    if (c === 0) {
      console.log(`  ${t.name.padEnd(28)} 0`);
      continue;
    }
    const delRes = await db.execute(
      sql.raw(`delete from ${t.name} where trim(${t.col}) = '${SID}'`),
    );
    // @ts-expect-error rowCount on driver result
    const deleted = delRes.rowCount ?? delRes.rows?.length ?? c;
    console.log(`  ${t.name.padEnd(28)} ${deleted}`);
  }

  // Step 3: delete the lead row itself
  const leadDel = await db.execute(
    sql`delete from leads where manychat_sub_id = ${SID} returning manychat_sub_id`,
  );
  // @ts-expect-error
  const leadDeleted = (leadDel.rows ?? leadDel).length;
  console.log(`  ${"leads".padEnd(28)} ${leadDeleted}`);

  // Step 4: verify
  const verify = await db.execute(
    sql`select count(*)::int as c from leads where phone_e164 = '972525755705' or manychat_sub_id = ${SID}`,
  );
  // @ts-expect-error
  const remaining = Number((verify.rows ?? verify)[0]?.c ?? 0);
  console.log(`\nRemaining rows in leads matching phone/sid: ${remaining}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
