import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const lead = await db.execute(
    sql`SELECT manychat_sub_id, name, active, ghl_contact_id, ghl_opportunity_id, wa_jid, phone_e164, pipeline_stage FROM leads WHERE manychat_sub_id LIKE 'playground:%'`
  );
  console.log("PLAYGROUND LEADS:", JSON.stringify(lead.rows ?? lead, null, 1));
  const msgs = await db.execute(
    sql`SELECT count(*)::int AS n FROM messages WHERE manychat_sub_id LIKE 'playground:%'`
  );
  console.log("playground messages:", JSON.stringify(msgs.rows ?? msgs));
  const leak = await db.execute(
    sql`SELECT count(*)::int AS n FROM messages WHERE payload->>'from' = 'playground' AND manychat_sub_id NOT LIKE 'playground:%'`
  );
  console.log("leaked rows on other leads:", JSON.stringify(leak.rows ?? leak));
}
main().then(() => process.exit(0));
