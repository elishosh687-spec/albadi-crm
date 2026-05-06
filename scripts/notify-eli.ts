/**
 * Save an escalation row + (optionally) push WhatsApp notification to Eli.
 *
 * Usage: tsx scripts/notify-eli.ts \
 *   --sub <subscriberId> \
 *   --name <leadName> \
 *   --reason <low_confidence|human_request|pricing|complaint|unknown> \
 *   --trigger "<trigger text>" \
 *   [--decision <decisionId>]
 *
 * NOTE: Currently records the escalation in DB only. WhatsApp push requires
 * a Meta-approved template (TEMPLATE_ESCALATION). Until templates are
 * approved, Eli sees escalations via the dashboard.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { escalations } from "../drizzle/schema";

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
  const reason = arg("reason", true)!;
  const triggerText = arg("trigger");
  const decisionIdStr = arg("decision");

  const [row] = await db
    .insert(escalations)
    .values({
      manychatSubId: sub,
      leadName: name ?? null,
      reason,
      triggerText: triggerText ?? null,
      decisionId: decisionIdStr ? Number(decisionIdStr) : null,
    })
    .returning({ id: escalations.id });

  console.log(`OK: escalation saved id=${row.id}`);
  console.log(`  sub=${sub} name=${name} reason=${reason}`);
  console.log(`  Eli will see this in dashboard /dashboard/escalations.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
