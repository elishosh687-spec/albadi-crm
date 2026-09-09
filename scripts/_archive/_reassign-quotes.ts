import { db } from "@/lib/db";
import { leads, factoryQuoteRequests } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
const GO=process.argv.includes("--go");
const last9=(s:string)=>(s??"").replace(/[^0-9]/g,"").slice(-9);

// target → { ghlContactId, phone (digits, "" if none), quotes: [] }
const TARGETS=[
  { name:"תכשיטי התאומים", ghl:"4RMoeUI6Bt2l3PiQ4WTG", phone:"", quotes:["7DSQAX35","4IVT9N69","8NN2PJS5"] },
  { name:"מלח הארץ",       ghl:"oscuZh1Ra3LUj8zJ7oH9", phone:"", quotes:["2S1VXFMY"] },
  { name:"יוסי גולד בייבי", ghl:"gHhoYOo0L7b57XsKT1bm", phone:"972527138477", quotes:["4TIMEAL4","U1SL6F4Y"] },
];

async function findExisting(ghl:string, phone:string){
  const rows=await db.select({sid:leads.manychatSubId,name:leads.name}).from(leads).where(
    phone ? sql`${leads.ghlContactId}=${ghl} OR ${leads.phoneE164} LIKE ${'%'+last9(phone)+'%'} OR ${leads.waJid} LIKE ${'%'+last9(phone)+'%'} OR ${leads.manychatSubId} LIKE ${'%'+last9(phone)+'%'}`
              : eq(leads.ghlContactId, ghl));
  return rows[0]??null;
}

async function main(){
  console.log(`${GO?"APPLYING":"DRY-RUN"}\n`);
  for(const t of TARGETS){
    const existing=await findExisting(t.ghl,t.phone);
    let sid:string;
    if(existing){ sid=existing.sid; console.log(`✓ target "${t.name}" — lead already exists (sid=${sid}, name="${existing.name}")`); }
    else {
      sid = t.phone ? `${t.phone}@s.whatsapp.net` : `ghl:${t.ghl}`;
      console.log(`＋ CREATE lead "${t.name}" — sid=${sid} ghl=${t.ghl} phone=${t.phone||"(none)"}`);
      if(GO) await db.insert(leads).values({
        manychatSubId: sid, name: t.name, ghlContactId: t.ghl,
        phoneE164: t.phone||null, waJid: t.phone?`${t.phone}@s.whatsapp.net`:null,
        active: true, source: "quote_reassign",
      });
    }
    // reassign quotes
    for(const q of t.quotes){
      const cur=await db.select({sid:factoryQuoteRequests.manychatSubId}).from(factoryQuoteRequests).where(eq(factoryQuoteRequests.quotationNo,q));
      if(!cur.length){ console.log(`    ⚠️ quote ${q} NOT FOUND`); continue; }
      console.log(`    ${q}: ${cur[0].sid} → ${sid}`);
      if(GO) await db.update(factoryQuoteRequests).set({manychatSubId:sid,updatedAt:new Date()}).where(eq(factoryQuoteRequests.quotationNo,q));
    }
    console.log("");
  }
  console.log(GO?"✅ done":"(dry-run — add --go to apply)");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
