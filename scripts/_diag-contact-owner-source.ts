/**
 * Why is the CONTACT owner still Itay while the OPPORTUNITY owner follows the
 * setting? Two suspects: (a) a GHL workflow re-assigns new contacts, (b) the
 * contact already existed when our sync ran, so we deliberately skip the owner.
 *
 *   DATABASE_URL="$(...)" npx tsx scripts/_diag-contact-owner-source.ts
 */
import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, isNotNull } from "drizzle-orm";

const NAMES: Record<string, string> = {
  ScW1WiffZkMkWH0NWVyy: "אלי",
  jTt6f6zPALPW2XVKVqok: "איתי",
};
const who = (id?: string | null) => (id ? (NAMES[id] ?? id) : "—");

async function main() {
  const [tok] = await db
    .select({ access: ghlOauthTokens.accessToken, loc: ghlOauthTokens.locationId })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  if (!tok?.access) return console.log("no token");
  const H = { Authorization: `Bearer ${tok.access}`, Version: "2021-07-28", Accept: "application/json" };

  // 1. Workflows that could be re-assigning contacts.
  const wf = await fetch(
    `https://services.leadconnectorhq.com/workflows/?locationId=${tok.loc}`,
    { headers: H }
  );
  const wj = (await wf.json()) as { workflows?: { id: string; name: string; status: string }[] };
  console.log(`— Workflows (${wj.workflows?.length ?? 0}):`);
  for (const w of wj.workflows ?? []) console.log(`   [${w.status}] ${w.name}`);

  // 2. For the newest leads: was the GHL contact created BEFORE our lead row?
  //    (i.e. GHL made it first → our sync skips the owner by design)
  const rows = await db
    .select({
      name: leads.name,
      contactId: leads.ghlContactId,
      createdAt: leads.createdAt,
      source: leads.source,
    })
    .from(leads)
    .where(isNotNull(leads.ghlContactId))
    .orderBy(desc(leads.createdAt))
    .limit(4);

  console.log(`\n— Timing (contact created in GHL vs lead row in CRM):`);
  for (const l of rows) {
    const c = await fetch(`https://services.leadconnectorhq.com/contacts/${l.contactId}`, { headers: H });
    const cj = (await c.json()) as {
      contact?: { assignedTo?: string; dateAdded?: string; source?: string; attributionSource?: { utmSessionSource?: string } };
    };
    const ct = cj.contact?.dateAdded ? new Date(cj.contact.dateAdded) : null;
    const lt = l.createdAt ? new Date(l.createdAt) : null;
    const deltaSec = ct && lt ? Math.round((ct.getTime() - lt.getTime()) / 1000) : null;
    console.log(
      `   ${(l.name ?? "").slice(0, 22).padEnd(24)} owner=${who(cj.contact?.assignedTo)} · ghl_source="${cj.contact?.source ?? "—"}"`
    );
    console.log(
      `      contact נוצר ${ct?.toISOString().slice(0, 19) ?? "—"} · ליד נוצר ${lt?.toISOString().slice(0, 19) ?? "—"}` +
        (deltaSec !== null ? ` · הפרש ${deltaSec}s ${deltaSec < 0 ? "(GHL הקדים!)" : "(אנחנו הקדמנו)"}` : "")
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
