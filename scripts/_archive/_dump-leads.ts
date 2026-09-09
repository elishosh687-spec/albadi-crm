import { db } from '../lib/db';
import { leads } from '../drizzle/schema';
import { desc, or, isNull, notInArray } from 'drizzle-orm';

(async () => {
  const rows = await db.select({
    name: leads.name,
    phone: leads.phoneE164,
    stage: leads.pipelineStage,
    flag: leads.pipelineFlag,
    paused: leads.botPaused,
    quote: leads.quoteTotal,
    followUp: leads.followUpDate,
    updated: leads.updatedAt,
    notes: leads.notes,
    botSummary: leads.botSummary,
  }).from(leads).where(
    or(isNull(leads.pipelineStage), notInArray(leads.pipelineStage, ['WON','LOST']))
  ).orderBy(desc(leads.updatedAt)).limit(60);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})();
