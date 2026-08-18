/**
 * Move the Contact Owner of the leads created AFTER the assignee setting was
 * changed (2026-08-01 23:58Z) from Itay to the configured assignee. Their
 * Opportunity Owner is already correct — the "assigh to user" GHL workflow only
 * overrode the contact side, and it is now stopped.
 *
 * Dry-run by default; --go applies. Only touches contacts currently owned by
 * Itay, so re-running is safe.
 *
 *   DATABASE_URL="$(...)" npx tsx scripts/_reassign-today-contacts.ts [--go]
 */
import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { and, desc, gte, isNotNull } from "drizzle-orm";
import { resolveAssigneeUserId } from "@/lib/crm-tasks/assignee";

const GO = process.argv.includes("--go");
const SINCE = new Date("2026-08-01T23:58:00Z"); // when the setting was saved
const ITAY = "jTt6f6zPALPW2XVKVqok";
const NAMES: Record<string, string> = { ScW1WiffZkMkWH0NWVyy: "אלי", [ITAY]: "איתי" };
const who = (id?: string | null) => (id ? (NAMES[id] ?? id) : "— ללא —");

async function main() {
  const target = await resolveAssigneeUserId();
  if (!target) return console.log("אין assignee מוגדר — עצור");
  console.log(`${GO ? "מבצע" : "הרצה יבשה"} · יעד: ${who(target)}\n`);

  const [tok] = await db
    .select({ access: ghlOauthTokens.accessToken })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  if (!tok?.access) return console.log("no GHL token");
  const H = {
    Authorization: `Bearer ${tok.access}`,
    Version: "2021-07-28",
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const rows = await db
    .select({ name: leads.name, contactId: leads.ghlContactId, createdAt: leads.createdAt })
    .from(leads)
    .where(and(isNotNull(leads.ghlContactId), gte(leads.createdAt, SINCE)))
    .orderBy(desc(leads.createdAt));

  console.log(`${rows.length} לידים מאז ${SINCE.toISOString().slice(0, 16)}\n`);
  let changed = 0;
  for (const l of rows) {
    const c = await fetch(`https://services.leadconnectorhq.com/contacts/${l.contactId}`, { headers: H });
    const cj = (await c.json()) as { contact?: { assignedTo?: string } };
    const owner = cj.contact?.assignedTo;
    const label = (l.name ?? l.contactId ?? "").slice(0, 26).padEnd(28);
    if (owner === target) { console.log(`   ${label} כבר ${who(owner)} — מדלג`); continue; }
    if (owner !== ITAY) { console.log(`   ${label} בעלים ${who(owner)} — לא איתי, לא נוגע`); continue; }

    console.log(`${GO ? "✔" : "→"}  ${label} ${who(owner)} → ${who(target)}`);
    if (GO) {
      const res = await fetch(`https://services.leadconnectorhq.com/contacts/${l.contactId}`, {
        method: "PUT",
        headers: H,
        body: JSON.stringify({ assignedTo: target }),
      });
      if (!res.ok) {
        console.log(`      ✗ נכשל: ${res.status} ${(await res.text()).slice(0, 160)}`);
        continue;
      }
    }
    changed++;
  }
  console.log(`\n${GO ? "הועברו" : "יועברו"}: ${changed}`);
  if (!GO) console.log("(הרץ עם --go לביצוע)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
