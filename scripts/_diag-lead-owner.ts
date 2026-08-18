/**
 * Who actually owns the newest leads in GHL — contact owner + opportunity owner
 * — vs what the CRM configured. Tells us whether our create is being overridden
 * (GHL workflow / round-robin) or never carried an owner at all.
 *
 *   DATABASE_URL="$(...)" npx tsx scripts/_diag-lead-owner.ts
 */
import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, isNotNull } from "drizzle-orm";
import { resolveAssigneeUserId } from "@/lib/crm-tasks/assignee";

const NAMES: Record<string, string> = {
  ScW1WiffZkMkWH0NWVyy: "אלי (Elazar)",
  jTt6f6zPALPW2XVKVqok: "איתי",
};
const who = (id?: string | null) => (id ? (NAMES[id] ?? id) : "— ללא בעלים —");

async function main() {
  const configured = await resolveAssigneeUserId();
  console.log(`המערכת מוגדרת לשייך ל: ${who(configured)}\n`);

  const [tok] = await db
    .select({ access: ghlOauthTokens.accessToken, loc: ghlOauthTokens.locationId })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  if (!tok?.access) { console.log("no GHL token"); return; }
  const H = { Authorization: `Bearer ${tok.access}`, Version: "2021-07-28", Accept: "application/json" };

  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      contactId: leads.ghlContactId,
      oppId: leads.ghlOpportunityId,
      createdAt: leads.createdAt,
      source: leads.source,
    })
    .from(leads)
    .where(isNotNull(leads.ghlContactId))
    .orderBy(desc(leads.createdAt))
    .limit(8);

  for (const l of rows) {
    let contactOwner: string | undefined;
    let oppOwner: string | undefined;
    try {
      const c = await fetch(`https://services.leadconnectorhq.com/contacts/${l.contactId}`, { headers: H });
      const cj = (await c.json()) as { contact?: { assignedTo?: string } };
      contactOwner = cj.contact?.assignedTo;
    } catch { /* ignore */ }
    if (l.oppId) {
      try {
        const o = await fetch(`https://services.leadconnectorhq.com/opportunities/${l.oppId}`, { headers: H });
        const oj = (await o.json()) as { opportunity?: { assignedTo?: string } };
        oppOwner = oj.opportunity?.assignedTo;
      } catch { /* ignore */ }
    }
    console.log(
      `${(l.name ?? l.sid).slice(0, 24).padEnd(26)} נוצר ${l.createdAt?.toISOString().slice(0, 16)} · מקור ${l.source ?? "—"}`
    );
    console.log(`   Contact Owner:     ${who(contactOwner)}`);
    console.log(`   Opportunity Owner: ${l.oppId ? who(oppOwner) : "— אין הזדמנות —"}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
