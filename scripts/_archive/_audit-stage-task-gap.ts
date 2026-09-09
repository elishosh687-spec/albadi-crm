import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const ORDER = ['INTAKE','DISCAVERY','FACTORY_WAIT','CONSIDERATION','FUTURE_FOLLOW_UP','NO_RESPONSE_REENGAGE'];
const HE: Record<string,string> = {
  INTAKE:'שאלון + הצעה אוטומטית', DISCAVERY:'שיחת בירור', FACTORY_WAIT:'בדיקת מפעל',
  CONSIDERATION:'שוקל הצעה / מו״מ', FUTURE_FOLLOW_UP:'מעקב עתידי', NO_RESPONSE_REENGAGE:'לא ענה / חידוש קשר'
};

async function main() {
  const rows = await sql`
    SELECT l.name, l.phone_e164 AS phone, l.pipeline_stage AS stage,
           l.ghl_contact_id, l.bot_paused, l.follow_up_date,
           EXTRACT(DAY FROM now()-l.updated_at)::int AS days_idle,
           (SELECT COUNT(*)::int FROM crm_tasks t
              WHERE t.manychat_sub_id=l.manychat_sub_id AND t.status='open') AS open_tasks
    FROM leads l
    WHERE l.pipeline_stage = ANY(${ORDER})
      AND l.name NOT IN ('ווצאפ עסקי','אלבדי')
      AND NOT (l.ghl_contact_id IS NULL AND l.name ILIKE '%test%')
    ORDER BY days_idle DESC`;

  for (const st of ORDER) {
    const g = rows.filter((r:any)=>r.stage===st);
    if (!g.length) continue;
    const gaps = g.filter((r:any)=>r.open_tasks===0).length;
    console.log(`\n━━━ ${st} — ${HE[st]}  (${g.length} לידים, ${gaps} בלי משימה) ━━━`);
    for (const r of g) {
      const flag = r.open_tasks===0 ? '🔴 אין משימה' : `✅ ${r.open_tasks} משימות`;
      const fu = r.follow_up_date ? `מעקב ${String(r.follow_up_date).slice(0,10)}` : 'אין מעקב';
      console.log(`  ${flag.padEnd(14)} | ${r.name}  (${r.phone})  | ${r.days_idle}ד | ${fu}${r.bot_paused?' | bot מושהה':''}`);
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
