/**
 * One-off: remove Simon (the colleague in China) from the CRM.
 *
 * He was never a customer. On 2026-08-27 he answered a question we had sent
 * him, the Green webhook saw an unknown number, made him a lead, synced a GHL
 * contact and opened the Hebrew questionnaire on him. The webhook now checks
 * `crm.team` first (see lib/notify/team.ts findTeamMemberByPhone), so this
 * cleans up the one row that slipped through before the guard existed.
 *
 * Order matters: the GHL contact goes FIRST. Delete the DB row while the GHL
 * contact still exists and the next resync recreates it from GHL state.
 *
 * Dry run by default; pass --go to actually delete.
 *
 *   DATABASE_URL="$(…neonctl connection-string …)" npx tsx scripts/_purge-simon-lead.ts
 *   DATABASE_URL="…" npx tsx scripts/_purge-simon-lead.ts --go
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

const SID = "8615180009512@c.us";
const GO = process.argv.includes("--go");

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
  { name: "setter_decisions", col: "manychat_sub_id" },
  { name: "lead_analyses", col: "manychat_sub_id" },
];

async function ghlToken(): Promise<{ token: string; locationId: string } | null> {
  const r = await db.execute(
    sql`select access_token, location_id from ghl_oauth_tokens order by updated_at desc limit 1`,
  );
  const row = (r as unknown as { rows: any[] }).rows?.[0];
  if (!row?.access_token) return null;
  return { token: row.access_token as string, locationId: row.location_id as string };
}

async function main() {
  const lead = await db.execute(
    sql`select manychat_sub_id, name, phone_e164, ghl_contact_id, pipeline_stage
        from leads where manychat_sub_id = ${SID}`,
  );
  const row = (lead as unknown as { rows: any[] }).rows?.[0];
  if (!row) {
    console.log(`אין ליד עם sid=${SID} — כנראה כבר נוקה.`);
    return;
  }
  console.log(`נמצא: ${row.name} | ${row.phone_e164} | GHL=${row.ghl_contact_id} | stage=${row.pipeline_stage}`);
  console.log(GO ? "\n=== מוחק ===\n" : "\n=== DRY RUN (הוסף --go כדי למחוק) ===\n");

  // 1. GHL contact first.
  if (row.ghl_contact_id) {
    if (!GO) {
      console.log(`GHL  DELETE /contacts/${row.ghl_contact_id}`);
    } else {
      const auth = await ghlToken();
      if (!auth) {
        console.error("אין access token ב-ghl_oauth_tokens — עצור, אל תמחק מה-DB.");
        process.exit(1);
      }
      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/${row.ghl_contact_id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            Version: "2021-07-28",
            Accept: "application/json",
          },
        },
      );
      const body = await res.text();
      if (!res.ok) {
        console.error(`מחיקת איש הקשר ב-GHL נכשלה (${res.status}): ${body}`);
        console.error("עוצר — מחיקת ה-DB לבדה תיצור אותו מחדש בריסינק הבא.");
        process.exit(1);
      }
      console.log(`GHL  איש הקשר נמחק (${res.status})`);
    }
  }

  // 2. DB rows.
  for (const t of SID_TABLES) {
    try {
      const q = GO
        ? sql`delete from ${sql.identifier(t.name)} where ${sql.identifier(t.col)} = ${SID}`
        : sql`select count(*)::int n from ${sql.identifier(t.name)} where ${sql.identifier(t.col)} = ${SID}`;
      const r = await db.execute(q);
      const n = GO
        ? (r as any).rowCount ?? 0
        : ((r as unknown as { rows: any[] }).rows?.[0]?.n ?? 0);
      if (n) console.log(`${GO ? "נמחקו" : "יימחקו"} ${String(n).padStart(3)} שורות מ-${t.name}`);
    } catch (e) {
      console.warn(`דילוג על ${t.name}: ${(e as Error).message}`);
    }
  }

  if (GO) {
    const r = await db.execute(sql`delete from leads where manychat_sub_id = ${SID}`);
    console.log(`נמחקו ${(r as any).rowCount ?? 0} שורות מ-leads`);
    const check = await db.execute(
      sql`select count(*)::int n from leads where manychat_sub_id = ${SID}`,
    );
    console.log(`אימות: נשארו ${(check as unknown as { rows: any[] }).rows[0].n} שורות.`);
  } else {
    console.log("יימחקו   1 שורות מ-leads");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
