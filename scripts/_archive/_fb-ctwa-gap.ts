/**
 * Audit Click-to-WhatsApp campaign funnel:
 *   FB ad shows 19 clicks-to-WA. DB shows 11 new leads. Where do 8 go?
 *
 * Two layers in the system we can check locally:
 *   1. bridge_events of type 'message.received' in the last 72h — anyone the
 *      bridge saw at all. If this matches DB lead count, no leads dropped.
 *   2. messages with direction='in' in the last 72h — distinct senders.
 */
import { db } from "../lib/db";
import { bridgeEvents, leads, messages } from "../drizzle/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";

async function main() {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000);

  const inboundEvents = await db
    .select({
      evtId: bridgeEvents.evtId,
      type: bridgeEvents.type,
      occurredAt: bridgeEvents.occurredAt,
      payload: bridgeEvents.payload,
    })
    .from(bridgeEvents)
    .where(and(gte(bridgeEvents.occurredAt, since), eq(bridgeEvents.type, "message.received")))
    .orderBy(desc(bridgeEvents.occurredAt));

  const distinctSenders = new Set<string>();
  for (const e of inboundEvents) {
    const p: any = e.payload;
    const jid = p?.chat_jid ?? p?.from ?? p?.sender ?? p?.peer_jid ?? null;
    if (jid) distinctSenders.add(String(jid));
  }

  const inboundMsgs = await db
    .select({
      sid: messages.manychatSubId,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .where(and(gte(messages.receivedAt, since), eq(messages.direction, "in")));
  const distinctMsgSids = new Set(inboundMsgs.map((m) => m.sid));

  const newLeads = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      source: leads.source,
      leadSource: sql<string | null>`${leads.leadSource}`,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(gte(leads.createdAt, since))
    .orderBy(desc(leads.createdAt));

  console.log(`\n=== Click-to-WhatsApp funnel (last 72h, since ${since.toISOString().slice(0,16)} UTC) ===\n`);
  console.log(`Facebook Ads Manager reports : 19`);
  console.log(`bridge_events message.received: ${inboundEvents.length}  (distinct senders: ${distinctSenders.size})`);
  console.log(`messages direction='in'       : ${inboundMsgs.length}  (distinct sids: ${distinctMsgSids.size})`);
  console.log(`leads created                 : ${newLeads.length}\n`);

  console.log(`Funnel drop-offs in our system:`);
  console.log(`  inbound-senders → distinct-msg-sids : ${distinctSenders.size - distinctMsgSids.size}`);
  console.log(`  distinct-msg-sids → leads created   : ${distinctMsgSids.size - newLeads.length}\n`);

  const newSidsSet = new Set(newLeads.map((l) => l.sid));
  const msgSidsWithoutLeadRow = [...distinctMsgSids].filter((s) => !newSidsSet.has(s));

  if (msgSidsWithoutLeadRow.length > 0) {
    console.log(`Senders that messaged but have NO lead row created in window (${msgSidsWithoutLeadRow.length}):`);
    const sample = msgSidsWithoutLeadRow.slice(0, 20);
    for (const sid of sample) {
      const existing = await db
        .select({ sid: leads.manychatSubId, name: leads.name, phone: leads.phoneE164, createdAt: leads.createdAt })
        .from(leads)
        .where(eq(leads.manychatSubId, sid))
        .limit(1);
      const e = existing[0];
      if (e) {
        console.log(`  • ${sid}  (existing lead, created ${new Date(e.createdAt).toISOString().slice(0,16)}, ${e.name ?? "no name"}, ${e.phone ?? "no phone"})`);
      } else {
        console.log(`  • ${sid}  (no lead row at all — orphan message!)`);
      }
    }
  }

  if (newLeads.length > 0) {
    console.log(`\nNew leads in window: ${newLeads.length}`);
    const fbTagged = newLeads.filter((l) => l.leadSource === "facebook" || l.source === "facebook");
    console.log(`  marked source/leadSource=facebook : ${fbTagged.length}`);
    console.log(`  marked source=greenapi_webhook    : ${newLeads.filter((l) => l.source === "greenapi_webhook").length}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
