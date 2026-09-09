import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const tok: any = await db.execute(sql`SELECT access_token, location_id FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1`);
  const { access_token, location_id } = (tok.rows??tok)[0];
  const H = { Authorization: `Bearer ${access_token}`, Version: "2021-07-28", Accept: "application/json" } as any;
  const rows: any = await db.execute(sql`SELECT conversation_id, ghl_contact_id, phone, posted_note_id FROM elevenlabs_call_imports WHERE status='posted' ORDER BY updated_at DESC`);
  for (const r of (rows.rows??rows)) {
    // contact name
    let name = "?";
    try { const c = await fetch(`https://services.leadconnectorhq.com/contacts/${r.ghl_contact_id}`,{headers:H}); const cj:any = await c.json(); name = cj.contact?.contactName || cj.contact?.firstName || "(no name)"; } catch {}
    // notes
    const nr = await fetch(`https://services.leadconnectorhq.com/contacts/${r.ghl_contact_id}/notes`,{headers:H});
    const nj: any = await nr.json();
    const note = (nj.notes||[]).find((n:any)=>(n.body||"").includes("CALL-ANALYSIS-11L"));
    console.log(`\n### contact ${r.ghl_contact_id} (${name}) | phone ${r.phone}`);
    console.log(`note present: ${note?"YES":"NO"} | conv ${r.conversation_id}`);
    if (note) console.log(note.body.slice(0,260));
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
