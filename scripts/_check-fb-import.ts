import { db } from "../lib/db";
import { leads, leadTags } from "../drizzle/schema";
import { eq, desc, gte, and, or } from "drizzle-orm";

async function main() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const fbImports = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      source: leads.source,
      leadSource: leads.leadSource,
      createdAt: leads.createdAt,
      stage: leads.pipelineStage,
    })
    .from(leads)
    .where(
      and(
        gte(leads.createdAt, since),
        or(eq(leads.source, "facebook_import"), eq(leads.leadSource, "facebook")),
      ),
    )
    .orderBy(desc(leads.createdAt));

  console.log(`\n=== Leads via facebook_import in last 24h ===\n`);
  console.log(`Total: ${fbImports.length}\n`);

  if (fbImports.length === 0) {
    console.log("(none yet — either no real leads have come through, or the test row was correctly skipped)");
    return;
  }

  for (const l of fbImports.slice(0, 20)) {
    console.log(
      `  ${new Date(l.createdAt).toISOString().slice(0, 16).replace("T", " ")}  ${(l.name ?? "—").padEnd(22)} ${(l.phone ?? "—").padEnd(15)} src=${l.source}  leadSrc=${l.leadSource ?? "—"}  stage=${l.stage ?? "—"}`,
    );
  }

  console.log("\n=== ליד_חדש tag count (last 24h additions) ===");
  const fbTagged = await db
    .select({ sid: leadTags.manychatSubId, setAt: leadTags.setAt })
    .from(leadTags)
    .where(and(eq(leadTags.tag, "ליד_חדש"), gte(leadTags.setAt, since)))
    .orderBy(desc(leadTags.setAt));
  console.log(`  tagged in last 24h: ${fbTagged.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
