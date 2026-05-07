/**
 * Send a single Meta-approved WhatsApp template to a subscriber via ManyChat.
 *
 * Usage:
 *   tsx scripts/send-template.ts \
 *     --sub <subscriberId> \
 *     --template <env_var_name> \
 *     --vars '{"1":"5000","2":"Basel"}' \
 *     [--dry-run]
 *
 * Examples:
 *   --template TEMPLATE_FOLLOWUP_QUOTE_SENT
 *   --vars '{"1":"5000","2":"Basel Mahamid"}'
 */
import "dotenv/config";
import { db } from "../lib/db";
import { repliesSent } from "../drizzle/schema";
import { MANYCHAT_BASE, MANYCHAT_TOKEN } from "../lib/manychat/config";

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

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function sendViaManyChat(
  subscriberId: string,
  templateId: string,
  vars: Record<string, string>
) {
  const res = await fetch(`${MANYCHAT_BASE}/sending/sendContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MANYCHAT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: {
        version: "v2",
        content: {
          messages: [
            {
              type: "whatsapp_template",
              template_id: templateId,
              variables: vars,
            },
          ],
        },
      },
    }),
  });

  const json = (await res.json()) as { status: string; message?: string; data?: any };
  if (!res.ok || json.status !== "success") {
    throw new Error(`ManyChat send failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function main() {
  const sub = arg("sub", true)!;
  const templateEnvName = arg("template", true)!;
  const varsStr = arg("vars") ?? "{}";
  const dryRun = flag("dry-run");

  const templateId = process.env[templateEnvName];
  if (!templateId) {
    console.error(`ENV var ${templateEnvName} not set in .env. Has Meta approved this template?`);
    process.exit(1);
  }

  let vars: Record<string, string>;
  try {
    vars = JSON.parse(varsStr);
  } catch (e) {
    console.error(`Invalid --vars JSON: ${varsStr}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`DRY RUN — would send:`);
    console.log(`  subscriber_id: ${sub}`);
    console.log(`  template_id:   ${templateId} (${templateEnvName})`);
    console.log(`  variables:     ${JSON.stringify(vars)}`);
    return;
  }

  const result = await sendViaManyChat(sub, templateId, vars);

  await db.insert(repliesSent).values({
    manychatSubId: sub,
    templateUsed: templateEnvName,
    text: `template:${templateEnvName} vars:${JSON.stringify(vars)}`,
    manychatMsgId: result?.message_id ?? null,
  });

  console.log(`OK: sent ${templateEnvName} to ${sub}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
