import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { LeadsView } from "./LeadsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LeadsPage() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      quoteTotal: leads.quoteTotal,
      botSummary: leads.botSummary,
      notes: leads.notes,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  return <LeadsView leads={rows} />;
}
