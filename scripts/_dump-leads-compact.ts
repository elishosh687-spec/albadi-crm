import { db } from '../lib/db';
import { leads, messages } from '../drizzle/schema';
import { desc, or, isNull, notInArray, eq, sql, and } from 'drizzle-orm';

function shortNote(notes: string | null, botSummary: string | null): string {
  if (!notes && !botSummary) return botSummary || '—';
  const src = notes || '';
  const internal = src.match(/📝 Internal notes\n([\s\S]+?)(?:\n\n---|\n*$)/);
  if (internal) return 'INT: ' + internal[1].trim().slice(0, 250);
  const call = src.match(/🧭 סיכום: ([^\n]+)/);
  const next = src.match(/➡️ צעדים הבאים:\n([\s\S]+?)\nרגש:/);
  if (call || next) {
    const parts = [];
    if (call) parts.push(call[1]);
    if (next) parts.push('NEXT: ' + next[1].replace(/\n/g, ' | ').slice(0, 200));
    return parts.join(' || ');
  }
  return botSummary || src.slice(0, 200);
}

(async () => {
  const rows = await db.select().from(leads).where(
    or(isNull(leads.pipelineStage), notInArray(leads.pipelineStage, ['WON','LOST']))
  ).orderBy(desc(leads.updatedAt)).limit(60);

  const out: any[] = [];
  for (const r of rows as any[]) {
    const lastInbound = await db.select({ at: messages.receivedAt })
      .from(messages)
      .where(and(eq(messages.manychatSubId, r.manychatSubId), eq(messages.sender, 'lead')))
      .orderBy(desc(messages.receivedAt)).limit(1);
    const lastOut = await db.select({ at: messages.receivedAt, sender: messages.sender })
      .from(messages)
      .where(and(eq(messages.manychatSubId, r.manychatSubId), sql`${messages.sender} IN ('bot','eli')`))
      .orderBy(desc(messages.receivedAt)).limit(1);
    out.push({
      name: r.name,
      phone: r.phoneE164,
      stage: r.pipelineStage,
      flag: r.pipelineFlag,
      paused: r.botPaused,
      quote: r.quoteTotal,
      followUp: r.followUpDate,
      updated: r.updatedAt,
      lastInbound: lastInbound[0]?.at || null,
      lastOut: lastOut[0]?.at || null,
      lastOutBy: lastOut[0]?.sender || null,
      summary: shortNote(r.notes, r.botSummary),
    });
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
