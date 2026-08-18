import { neon } from "@neondatabase/serverless";
import { writeFileSync, mkdirSync } from "fs";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT c.ghl_contact_id, l.name, l.pipeline_stage, l.manychat_sub_id,
           c.call_started_at, c.call_duration_sec, c.transcript,
           c.analysis->>'call_summary' AS summary
    FROM call_recording_imports c
    LEFT JOIN leads l ON l.ghl_contact_id = c.ghl_contact_id
    WHERE c.call_started_at >= '2026-06-19' AND c.transcript IS NOT NULL
      AND length(c.transcript) > 200
    ORDER BY c.ghl_contact_id, c.call_started_at
  `) as any[];

  mkdirSync("_research-sales-3w", { recursive: true });

  // group by contact
  const byContact = new Map<string, any[]>();
  for (const r of rows) {
    const k = r.ghl_contact_id || "unknown";
    if (!byContact.has(k)) byContact.set(k, []);
    byContact.get(k)!.push(r);
  }

  const blocks: string[] = [];
  for (const [cid, calls] of byContact) {
    const l = calls[0];
    let b = `\n\n========================================\nLEAD: ${l.name || "?"} | stage=${l.pipeline_stage || "NULL"} | sid=${l.manychat_sub_id || "?"} | contact=${cid} | calls_in_window=${calls.length}\n`;
    for (const c of calls) {
      b += `\n--- CALL ${new Date(c.call_started_at).toISOString().slice(0, 16)} | ${c.call_duration_sec}s ---\n${c.transcript.trim()}\n`;
    }
    blocks.push(b);
  }

  // split into ~5 chunks balanced by size
  const N = 5;
  const chunks: string[][] = Array.from({ length: N }, () => []);
  const sizes = new Array(N).fill(0);
  blocks.sort((a, b) => b.length - a.length);
  for (const b of blocks) {
    const i = sizes.indexOf(Math.min(...sizes));
    chunks[i].push(b);
    sizes[i] += b.length;
  }
  chunks.forEach((c, i) => {
    writeFileSync(`_research-sales-3w/transcripts-${i + 1}.txt`, c.join(""));
    console.log(`chunk ${i + 1}: ${sizes[i]} chars, ${c.length} leads`);
  });
  console.log(`total leads: ${byContact.size}, calls: ${rows.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
