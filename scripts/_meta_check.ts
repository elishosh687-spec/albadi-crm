import { neon } from "@neondatabase/serverless";
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const r = await sql`
    SELECT name, manychat_sub_id AS sid,
           meta_leadgen_id IS NOT NULL AS has_leadgen,
           meta_fbclid IS NOT NULL AS has_fbclid,
           meta_qualified_sent_at IS NOT NULL AS qualified_sent
    FROM leads
    WHERE name ILIKE '%אוריאלי%' OR manychat_sub_id LIKE '972527138477%'`;
  console.log(JSON.stringify(r, null, 1));
}
main();
