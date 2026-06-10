import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { gte, desc } from "drizzle-orm";

async function main() {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      source: leads.source,
      stage: leads.pipelineStage,
      ghl: leads.ghlContactId,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(gte(leads.createdAt, since))
    .orderBy(desc(leads.createdAt));

  console.log(`\n=== Leads created in last 72h (since ${since.toISOString().slice(0,16).replace("T"," ")} UTC) ===\n`);
  console.log(`Total: ${rows.length}\n`);

  const bySource: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  let withGhl = 0;
  for (const r of rows) {
    bySource[r.source ?? "(null)"] = (bySource[r.source ?? "(null)"] ?? 0) + 1;
    byStage[r.stage ?? "(null)"] = (byStage[r.stage ?? "(null)"] ?? 0) + 1;
    if (r.ghl) withGhl++;
  }

  console.log("By source:");
  for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(15)} ${v}`);
  console.log(`\nBy stage:`);
  for (const [k, v] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log(`\nSynced to GHL: ${withGhl} / ${rows.length}\n`);

  console.log("Most recent 25:");
  for (const r of rows.slice(0, 25)) {
    console.log(
      `  ${new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 16)}  ${(r.name ?? "(no name)").padEnd(22)} ${(r.phone ?? "—").padEnd(15)} src=${(r.source ?? "?").padEnd(8)} stage=${(r.stage ?? "—").padEnd(14)} ghl=${r.ghl ? "✓" : "—"}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
