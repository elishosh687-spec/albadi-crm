import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

type Analysis = {
  call_summary?: string;
  customer_needs?: string[];
  objections?: { text: string; quote?: string }[];
  price_discussion?: string | null;
  competitor_mentions?: string[];
  next_steps?: string[];
  sentiment?: string;
  buying_signals?: string[];
  red_flags?: string[];
  follow_up_urgency?: string;
};

async function main() {
  const ghl = await db.execute(sql`
    SELECT analysis FROM call_recording_imports WHERE analysis IS NOT NULL
  `);
  const eleven = await db.execute(sql`
    SELECT analysis FROM elevenlabs_call_imports WHERE analysis IS NOT NULL
  `);

  const all: Analysis[] = [
    ...ghl.rows.map((r: any) => r.analysis),
    ...eleven.rows.map((r: any) => r.analysis),
  ].filter(Boolean);

  const sentiment: Record<string, number> = {};
  const objections: string[] = [];
  const priceTalk: string[] = [];
  const competitors: string[] = [];
  const redFlags: string[] = [];
  const buyingSignals: string[] = [];
  const needs: string[] = [];

  for (const a of all) {
    sentiment[a.sentiment || "?"] = (sentiment[a.sentiment || "?"] || 0) + 1;
    (a.objections || []).forEach((o) => {
      if (o?.text) objections.push(o.text + (o.quote ? `  «${o.quote}»` : ""));
    });
    if (a.price_discussion) priceTalk.push(a.price_discussion);
    (a.competitor_mentions || []).forEach((c) => c && competitors.push(c));
    (a.red_flags || []).forEach((c) => c && redFlags.push(c));
    (a.buying_signals || []).forEach((c) => c && buyingSignals.push(c));
    (a.customer_needs || []).forEach((c) => c && needs.push(c));
  }

  console.log("TOTAL ANALYZED CALLS:", all.length);
  console.log("\nSENTIMENT:", JSON.stringify(sentiment));
  console.log("\n===== OBJECTIONS (" + objections.length + ") =====");
  objections.forEach((o) => console.log("• " + o));
  console.log("\n===== PRICE DISCUSSION (" + priceTalk.length + ") =====");
  priceTalk.forEach((o) => console.log("• " + o));
  console.log("\n===== COMPETITOR MENTIONS (" + competitors.length + ") =====");
  competitors.forEach((o) => console.log("• " + o));
  console.log("\n===== RED FLAGS (" + redFlags.length + ") =====");
  redFlags.forEach((o) => console.log("• " + o));
  console.log("\n===== CUSTOMER NEEDS (" + needs.length + ") =====");
  needs.forEach((o) => console.log("• " + o));
  console.log("\n===== BUYING SIGNALS (" + buyingSignals.length + ") =====");
  buyingSignals.forEach((o) => console.log("• " + o));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
