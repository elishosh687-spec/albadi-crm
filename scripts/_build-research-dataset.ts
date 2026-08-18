import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const OUT = path.join(process.cwd(), "_research-objections");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ---- GHL-native calls joined to lead by ghl_contact_id ----
  const ghl = await db.execute(sql`
    SELECT c.ghl_contact_id, c.call_duration_sec, c.call_started_at,
           c.analysis, c.transcript,
           l.manychat_sub_id, l.name, l.phone_e164, l.pipeline_stage,
           l.quote_total, l.quote_alt, l.loss_reason, l.bot_summary,
           l.lead_source, l.created_at AS lead_created
    FROM call_recording_imports c
    LEFT JOIN leads l ON l.ghl_contact_id = c.ghl_contact_id
    WHERE c.transcript IS NOT NULL
    ORDER BY c.call_started_at DESC NULLS LAST
  `);

  // ---- ElevenLabs calls joined to lead by phone digits ----
  const eleven = await db.execute(sql`
    SELECT e.conversation_id, e.phone, e.direction, e.call_duration_sec,
           e.call_started_at, e.analysis, e.transcript, e.eleven_summary,
           l.manychat_sub_id, l.name, l.pipeline_stage, l.quote_total,
           l.quote_alt, l.loss_reason, l.bot_summary, l.lead_source
    FROM elevenlabs_call_imports e
    LEFT JOIN leads l
      ON regexp_replace(l.phone_e164,'[^0-9]','','g') LIKE '%' || regexp_replace(COALESCE(e.phone,''),'[^0-9]','','g')
    WHERE e.transcript IS NOT NULL AND COALESCE(e.phone,'') <> ''
    ORDER BY e.call_started_at DESC NULLS LAST
  `);

  // ---- Full message timeline for every lead that has a call ----
  const subIds = new Set<string>();
  [...ghl.rows, ...eleven.rows].forEach((r: any) => {
    if (r.manychat_sub_id) subIds.add(r.manychat_sub_id);
  });
  const ids = [...subIds];

  const msgsBySub: Record<string, any[]> = {};
  if (ids.length) {
    const msgs = await db.execute(sql`
      SELECT manychat_sub_id, direction, sender, text, received_at
      FROM messages
      WHERE manychat_sub_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      ORDER BY received_at ASC
    `);
    for (const m of msgs.rows as any[]) {
      (msgsBySub[m.manychat_sub_id] ||= []).push({
        dir: m.direction,
        sender: m.sender,
        t: m.text,
        at: m.received_at,
      });
    }
  }

  // Attach message timelines
  const ghlEnriched = ghl.rows.map((r: any) => ({
    ...r,
    messages: r.manychat_sub_id ? msgsBySub[r.manychat_sub_id] || [] : [],
  }));
  const elevenEnriched = eleven.rows.map((r: any) => ({
    ...r,
    messages: r.manychat_sub_id ? msgsBySub[r.manychat_sub_id] || [] : [],
  }));

  const all = [...ghlEnriched, ...elevenEnriched];

  // Write one big file + chunked files for fan-out
  fs.writeFileSync(path.join(OUT, "all-calls.json"), JSON.stringify(all, null, 2));

  const CHUNK = 28;
  let ci = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    ci++;
    fs.writeFileSync(
      path.join(OUT, `chunk-${ci}.json`),
      JSON.stringify(all.slice(i, i + CHUNK), null, 2)
    );
  }

  // Stats
  const linked = all.filter((r: any) => r.manychat_sub_id).length;
  const withMsgs = all.filter((r: any) => r.messages.length > 0).length;
  console.log("GHL calls w/ transcript:", ghl.rows.length);
  console.log("ElevenLabs calls w/ transcript+phone:", eleven.rows.length);
  console.log("Total call records:", all.length);
  console.log("Linked to a lead:", linked);
  console.log("With WhatsApp messages:", withMsgs);
  console.log("Chunks written:", ci, "to", OUT);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
