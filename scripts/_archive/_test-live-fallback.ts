process.env.BRIDGE_DRY_RUN = "1";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const sid = "playground:bot";
  const { resetPlayground, recordInbound } = await import("../lib/bot-playground/session");
  await resetPlayground();
  await db.update(leads).set({
    pipelineStage: "INTAKE",
    quoteTotal: "6050",
    qState: { step: 10, product: "p3", quantity: "q2", shipping: "s2", colors: "2",
              doneAt: new Date().toISOString(), subFlow: "awaiting_estimate_decision" },
  }).where(eq(leads.manychatSubId, sid));
  await recordInbound("יקר לי");

  const { handleDecisionInbound } = await import("../lib/autoresponder/decision");
  const res = await handleDecisionInbound({ sid, text: "יקר לי", hasMedia: false });
  console.log("result:", JSON.stringify(res));
  await resetPlayground();
}
main().then(() => process.exit(0));
