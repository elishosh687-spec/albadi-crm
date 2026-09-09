import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getObjectionPlay } from "@/lib/sales/objection-playbook.he";

type V = {
  sid: string; name: string | null; stage: string | null;
  insufficient_data: boolean; primary_blocker: string;
  objections: { text: string; quote: string; is_surface_or_root: string; taxonomy_key: string }[];
  commitment_scorecard: { score_1_5: number };
  followup_verdict: { promised: boolean; delivered: boolean } | null;
  sample: { asked: boolean; fulfilled: boolean } | null;
};

async function main() {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (a.manychat_sub_id) a.manychat_sub_id, a.verdict, l.pipeline_stage
    FROM lead_analyses a JOIN leads l ON l.manychat_sub_id = a.manychat_sub_id
    ORDER BY a.manychat_sub_id, a.created_at DESC
  `);
  const vs: V[] = (res.rows as any[]).map((r) => ({ ...(r.verdict as any), stage: r.pipeline_stage }));
  const conc = vs.filter((v) => !v.insufficient_data);

  console.log(`TOTAL analyzed: ${vs.length} | conclusive: ${conc.length} | insufficient: ${vs.length - conc.length}`);

  // by stage
  const byStage: Record<string, V[]> = {};
  conc.forEach((v) => { (byStage[v.stage ?? "NULL"] ||= []).push(v); });
  console.log("\n=== BY STAGE (conclusive) ===");
  for (const [st, arr] of Object.entries(byStage).sort((a,b)=>b[1].length-a[1].length)) {
    const blockers: Record<string, number> = {};
    arr.forEach((v) => { blockers[v.primary_blocker] = (blockers[v.primary_blocker]||0)+1; });
    const avgC = (arr.reduce((s,v)=>s+(v.commitment_scorecard?.score_1_5||0),0)/arr.length).toFixed(1);
    const bl = Object.entries(blockers).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(" ");
    console.log(`\n${st} (n=${arr.length}, avg commitment ${avgC}/5)`);
    console.log(`  חסמים: ${bl}`);
  }

  // overall blocker
  const blk: Record<string,string[]> = {};
  conc.forEach((v)=>{ (blk[v.primary_blocker] ||= []).push(v.name||v.sid); });
  console.log("\n=== OVERALL primary_blocker (of " + conc.length + ") ===");
  Object.entries(blk).sort((a,b)=>b[1].length-a[1].length).forEach(([k,arr])=>console.log(`  ${k}: ${arr.length} — ${arr.slice(0,8).join(", ")}${arr.length>8?"…":""}`));

  // objections taxonomy + quotes
  const objLeads: Record<string,Set<string>> = {};
  const objQuotes: Record<string,{q:string;name:string}[]> = {};
  conc.forEach((v)=>{
    const seen = new Set<string>();
    (v.objections||[]).forEach((o)=>{
      const k=o.taxonomy_key||"other";
      if(!seen.has(k)){ (objLeads[k] ||= new Set()).add(v.name||v.sid); seen.add(k); }
      if(o.quote){ (objQuotes[k] ||= []).push({q:o.quote,name:v.name||v.sid}); }
    });
  });
  console.log("\n=== OBJECTIONS by taxonomy (lead count of " + conc.length + ") ===");
  Object.entries(objLeads).sort((a,b)=>b[1].size-a[1].size).forEach(([k,set])=>{
    console.log(`\n  [${k}] ${getObjectionPlay(k).label}: ${set.size} לידים`);
    (objQuotes[k]||[]).slice(0,4).forEach((x)=>console.log(`     «${x.q}» — ${x.name}`));
  });

  // followup + sample
  const fuFail = conc.filter((v)=>v.followup_verdict?.promised && !v.followup_verdict?.delivered);
  const smGap = conc.filter((v)=>v.sample?.asked && !v.sample?.fulfilled);
  console.log(`\n=== כשלים ===`);
  console.log(`  הבטחנו ולא מסרנו: ${fuFail.length}/${conc.length} — ${fuFail.map(v=>v.name||v.sid).slice(0,10).join(", ")}`);
  console.log(`  ביקש דוגמה ולא קיבל: ${smGap.length}/${conc.length} — ${smGap.map(v=>v.name||v.sid).slice(0,10).join(", ")}`);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
