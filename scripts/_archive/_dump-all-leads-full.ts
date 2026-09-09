import { db } from '../lib/db';
import { leads, messages } from '../drizzle/schema';
import { desc, eq, sql, and } from 'drizzle-orm';

(async () => {
  const rows = await db.select().from(leads).orderBy(desc(leads.updatedAt)).limit(300);

  const out: any[] = [];
  for (const r of rows as any[]) {
    const lastInbound = await db.select({ at: messages.receivedAt })
      .from(messages)
      .where(and(eq(messages.manychatSubId, r.manychatSubId), eq(messages.sender, 'lead')))
      .orderBy(desc(messages.receivedAt)).limit(1);

    // Extract structured info from notes
    const notes = r.notes || '';
    const callSummaries: any[] = [];
    const callMatches = notes.matchAll(/📞 שיחה: ([^\n]+)\n🧭 סיכום: ([^\n]+)(?:[\s\S]*?➡️ צעדים הבאים:\n([\s\S]+?)\nרגש: (\w+)[\s\S]*?דחיפות מעקב: (\w+))?/g);
    for (const m of callMatches) {
      callSummaries.push({
        when: m[1].trim(),
        summary: m[2].trim().slice(0, 150),
        nextSteps: m[3]?.replace(/\n/g, ' | ').trim().slice(0, 200) || null,
        sentiment: m[4] || null,
        urgency: m[5] || null,
      });
    }
    const internalNotes = [...notes.matchAll(/📝 Internal notes\n([\s\S]+?)(?:\n\n---|\n*$)/g)].map(m => m[1].trim().slice(0, 300));
    const bracketed = [...notes.matchAll(/\[(\d{2}\.\d{2}\.\d{4}[^\]]*)\]([^\n]+)/g)].map(m => `${m[1]}: ${m[2].trim()}`).slice(0, 5);

    out.push({
      name: r.name,
      phone: r.phoneE164?.slice(-7),
      stage: r.pipelineStage,
      flag: r.pipelineFlag,
      paused: r.botPaused,
      followUp: r.followUpDate,
      lossReason: r.lossReason,
      lastInbound: lastInbound[0]?.at?.toISOString()?.slice(0,10) || null,
      botSummary: r.botSummary,
      calls: callSummaries,
      internal: internalNotes,
      shortNotes: bracketed,
    });
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
