import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const TEST_JID = "133144455962747@lid";

(async () => {
  await db.execute(sql`
    UPDATE leads SET
      pipeline_stage = NULL,
      q_state = NULL,
      bot_summary = NULL,
      next_action = NULL,
      follow_up_count = 0,
      last_follow_up_at = NULL,
      bot_paused = false,
      pipeline_flag = NULL,
      quote_total = NULL,
      quote_alt = NULL,
      updated_at = NOW()
    WHERE manychat_sub_id = ${TEST_JID}
  `);
  const d = await db.execute(sql`
    DELETE FROM messages WHERE manychat_sub_id = ${TEST_JID} RETURNING id
  `);
  console.log("reset done, messages deleted:", (d.rows ?? []).length);
})();
