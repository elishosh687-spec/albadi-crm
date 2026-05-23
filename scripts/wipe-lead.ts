/**
 * Hard-delete a lead and ALL related data from the DB. For testing.
 *
 * Usage:
 *   npx tsx scripts/wipe-lead.ts <phone>            # dry-run (shows what would be deleted)
 *   npx tsx scripts/wipe-lead.ts <phone> --go       # actually delete
 *   npx tsx scripts/wipe-lead.ts <phone> --go --ghl # also delete from GHL
 *
 * Phone format: any substring of E.164 (e.g. 972509111981 or 509111981)
 *
 * What gets deleted from DB:
 *   leads, lead_tags, messages, bot_drafts, bot_quotes, bot_decision_log,
 *   crm_tasks, crm_lead_episodes, crm_sla_timers, lead_score_snapshots,
 *   source_touches, opportunities, lead_events, factory_quote_requests,
 *   ghl_lead_tasks, bridge_events (filtered by chat_jid)
 *
 * NOTE: GHL deletion needs the OAuth token to have contacts.write — already
 * granted. If --ghl is omitted, the GHL contact stays (next message will
 * re-create the lead in DB).
 */
import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';
import { GHL_BASE, GHL_API_VERSION, requireGHLLocationId } from '../integrations/ghl/config';
import { getValidAccessToken } from '../integrations/ghl/oauth';

const PHONE = process.argv[2];
const GO = process.argv.includes('--go');
const ALSO_GHL = process.argv.includes('--ghl');

if (!PHONE) {
  console.error('Usage: npx tsx scripts/wipe-lead.ts <phone> [--go] [--ghl]');
  process.exit(1);
}

async function deleteGhlContact(contactId: string): Promise<boolean> {
  const locationId = requireGHLLocationId().replace(/^﻿/, '');
  const token = await getValidAccessToken(locationId);
  if (!token) { console.warn('  no OAuth token, skipping GHL delete'); return false; }
  const r = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
    },
  });
  if (r.ok) return true;
  console.warn(`  GHL delete ${contactId} failed: ${r.status} ${await r.text()}`);
  return false;
}

async function main() {
  const part = PHONE.replace(/^\+/, '').replace(/^972/, '').replace(/[^\d]/g, '').slice(-9);
  console.log(`searching for phone containing "${part}"\n`);

  const rows = await db.execute(sql`
    SELECT manychat_sub_id, wa_jid, phone_e164, name, ghl_contact_id, active
    FROM leads
    WHERE manychat_sub_id LIKE ${"%" + part + "%"}
       OR wa_jid LIKE ${"%" + part + "%"}
       OR phone_e164 LIKE ${"%" + part + "%"}
  `);
  const found = ((rows as any).rows ?? rows) as Array<{ manychat_sub_id: string; name: string | null; phone_e164: string | null; ghl_contact_id: string | null; active: boolean }>;

  if (found.length === 0) {
    console.log('No leads matched. Done.');
    process.exit(0);
  }

  console.log('found:');
  for (const r of found) {
    console.log(`  ${r.manychat_sub_id.padEnd(40)} name=${r.name ?? '—'} phone=${r.phone_e164 ?? '—'} ghl=${r.ghl_contact_id ?? '—'} active=${r.active}`);
  }
  console.log('');

  // Count related rows per sid
  for (const r of found) {
    const sid = r.manychat_sub_id;
    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM messages WHERE manychat_sub_id = ${sid}) AS messages,
        (SELECT count(*) FROM lead_tags WHERE manychat_sub_id = ${sid}) AS tags,
        (SELECT count(*) FROM bot_drafts WHERE manychat_sub_id = ${sid}) AS drafts,
        (SELECT count(*) FROM bot_quotes WHERE lead_sid = ${sid}) AS quotes,
        (SELECT count(*) FROM bot_decision_log WHERE manychat_sub_id = ${sid}) AS decisions,
        (SELECT count(*) FROM crm_tasks WHERE manychat_sub_id = ${sid}) AS tasks,
        (SELECT count(*) FROM lead_events WHERE manychat_sub_id = ${sid}) AS events,
        (SELECT count(*) FROM factory_quote_requests WHERE manychat_sub_id = ${sid}) AS factory,
        (SELECT count(*) FROM opportunities WHERE manychat_sub_id = ${sid}) AS opps,
        (SELECT count(*) FROM ghl_lead_tasks WHERE lead_sid = ${sid}) AS ghl_tasks
    `);
    const c = ((counts as any).rows ?? counts)[0];
    console.log(`  ${sid}:`);
    console.log(`    messages=${c.messages} drafts=${c.drafts} quotes=${c.quotes} decisions=${c.decisions} tasks=${c.tasks} events=${c.events} tags=${c.tags} factory=${c.factory} opps=${c.opps} ghl_tasks=${c.ghl_tasks}`);
  }

  if (!GO) {
    console.log('\n[dry-run] re-run with --go to actually delete.');
    console.log('         add --ghl to also delete the GHL contact.');
    process.exit(0);
  }

  console.log('\nWIPING...');
  for (const r of found) {
    const sid = r.manychat_sub_id;
    console.log(`\nwiping ${sid}`);
    await db.execute(sql`DELETE FROM lead_tags WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM messages WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM bot_drafts WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM bot_quotes WHERE lead_sid = ${sid}`);
    await db.execute(sql`DELETE FROM bot_decision_log WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM crm_tasks WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM crm_lead_episodes WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM crm_sla_timers WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM lead_score_snapshots WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM source_touches WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM opportunities WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM lead_events WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM factory_quote_requests WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM ghl_lead_tasks WHERE lead_sid = ${sid}`);
    await db.execute(sql`DELETE FROM bridge_events WHERE payload->>'sid' = ${sid} OR payload->'data'->>'chat_jid' = ${sid}`);
    await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id = ${sid}`);
    console.log(`  ✓ DB rows for ${sid} deleted`);

    if (ALSO_GHL && r.ghl_contact_id) {
      const ok = await deleteGhlContact(r.ghl_contact_id);
      console.log(`  ${ok ? '✓' : '✗'} GHL contact ${r.ghl_contact_id} ${ok ? 'deleted' : 'NOT deleted'}`);
    }
  }

  console.log('\n✓ done');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
