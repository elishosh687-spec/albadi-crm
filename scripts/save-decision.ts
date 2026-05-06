/**
 * Save a single decision to the audit log.
 *
 * Usage: tsx scripts/save-decision.ts \
 *   --sub <subscriberId> \
 *   --name <leadName> \
 *   --tag <classifiedTag> \
 *   --prev <prevTag> \
 *   --action <tag_only|reply_sent|escalated> \
 *   --rule <ruleName|null> \
 *   --ai <true|false> \
 *   --confidence <0-1>
 */
import "dotenv/config";
import { db } from "../lib/db";
import { decisions } from "../drizzle/schema";

function arg(name: string, required = false): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) {
    if (required) {
      console.error(`missing --${name}`);
      process.exit(1);
    }
    return undefined;
  }
  return process.argv[i + 1];
}

async function main() {
  const sub = arg("sub", true)!;
  const name = arg("name");
  const tag = arg("tag");
  const prev = arg("prev");
  const action = arg("action", true)!;
  const rule = arg("rule");
  const ai = arg("ai") === "true";
  const confidenceStr = arg("confidence");

  const [row] = await db
    .insert(decisions)
    .values({
      manychatSubId: sub,
      leadName: name ?? null,
      classifiedTag: tag ?? null,
      prevTag: prev ?? null,
      actionTaken: action,
      ruleMatched: rule && rule !== "null" ? rule : null,
      aiUsed: ai,
      aiConfidence: confidenceStr ? confidenceStr : null,
    })
    .returning({ id: decisions.id });

  console.log(`OK: decision saved id=${row.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
