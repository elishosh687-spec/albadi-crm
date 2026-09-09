import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // 1. GHL-native call analyses
  const ghlCalls = await db.execute(sql`
    SELECT ghl_contact_id, call_duration_sec, call_started_at, analysis, transcript
    FROM call_recording_imports
    WHERE analysis IS NOT NULL
    ORDER BY call_started_at DESC NULLS LAST
  `);

  // 2. ElevenLabs agent call analyses
  const elevenCalls = await db.execute(sql`
    SELECT phone, direction, call_duration_sec, call_started_at, analysis, eleven_summary, transcript
    FROM elevenlabs_call_imports
    WHERE analysis IS NOT NULL OR eleven_summary IS NOT NULL
    ORDER BY call_started_at DESC NULLS LAST
  `);

  // 3. Lead context: stages, loss reasons, quotes, summaries
  const leads = await db.execute(sql`
    SELECT pipeline_stage, COUNT(*) AS n
    FROM leads
    GROUP BY pipeline_stage
    ORDER BY n DESC
  `);

  const lossReasons = await db.execute(sql`
    SELECT loss_reason, COUNT(*) AS n
    FROM leads
    WHERE loss_reason IS NOT NULL AND loss_reason <> ''
    GROUP BY loss_reason
    ORDER BY n DESC
  `);

  const summaries = await db.execute(sql`
    SELECT name, pipeline_stage, quote_total, bot_summary
    FROM leads
    WHERE bot_summary IS NOT NULL AND bot_summary <> ''
    ORDER BY updated_at DESC
    LIMIT 200
  `);

  console.log("=== GHL CALL ANALYSES:", ghlCalls.rows.length, "===");
  console.log(JSON.stringify(ghlCalls.rows, null, 2));
  console.log("\n=== ELEVENLABS CALL ANALYSES:", elevenCalls.rows.length, "===");
  console.log(JSON.stringify(elevenCalls.rows, null, 2));
  console.log("\n=== PIPELINE STAGE COUNTS ===");
  console.log(JSON.stringify(leads.rows, null, 2));
  console.log("\n=== LOSS REASONS ===");
  console.log(JSON.stringify(lossReasons.rows, null, 2));
  console.log("\n=== BOT SUMMARIES:", summaries.rows.length, "===");
  console.log(JSON.stringify(summaries.rows, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
