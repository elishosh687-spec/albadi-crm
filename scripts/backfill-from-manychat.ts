/**
 * One-time backfill: pull every active lead from ManyChat, copy its tags +
 * 12 custom fields into the new DB columns, resolve phone → wa_jid via
 * the bridge. Idempotent — re-runnable. Pass --confirm to write.
 *
 * Without --confirm the script prints a per-lead diff and exits without
 * touching the DB.
 *
 * Run BEFORE flipping USE_BRIDGE=1 in production so dashboard reads the
 * DB-owned state instead of ManyChat.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads, leadTags } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  FIELD_IDS,
  TAG_IDS,
  type FieldName,
} from "../lib/manychat/id-maps";
import { V2_FLAG_TAG_IDS } from "../lib/manychat/stages";
import { getSubscriber } from "../lib/manychat/client";
import { resolveJidFromPhone } from "../lib/bridge/client";

const CONFIRM = process.argv.includes("--confirm");

// Drizzle column property names (camelCase) — keep aligned with
// drizzle/schema.ts so .set() recognises every key.
const FIELD_COLUMN: Record<FieldName, string> = {
  notes: "notes",
  quote_total: "quoteTotal",
  quote_alt: "quoteAlt",
  lead_source: "leadSource",
  last_contact_date: "lastContactDate",
  follow_up_date: "followUpDate",
  lead_score: "leadScore",
  quantity: "quantity",
  last_contact_type: "lastContactType",
  pipeline_stage: "pipelineStage",
  next_action: "nextAction",
  bot_summary: "botSummary",
};

const TAG_NAME_BY_ID = new Map<number, string>();
for (const [name, id] of Object.entries(TAG_IDS)) {
  TAG_NAME_BY_ID.set(id as number, name);
}
for (const [name, id] of Object.entries(V2_FLAG_TAG_IDS)) {
  TAG_NAME_BY_ID.set(id as number, name);
}

const FIELD_NAME_BY_ID = new Map<number, FieldName>();
for (const [name, id] of Object.entries(FIELD_IDS)) {
  FIELD_NAME_BY_ID.set(id as number, name as FieldName);
}

interface PlannedDiff {
  sid: string;
  name: string | null | undefined;
  phone: string | null | undefined;
  wa_jid: string | null;
  tags_to_add: string[];
  field_patch: Record<string, string>;
}

async function buildPlan(): Promise<PlannedDiff[]> {
  const all = await db
    .select({
      sid: leads.manychatSubId,
      currentJid: leads.waJid,
      currentPhone: leads.phoneE164,
    })
    .from(leads);

  const plans: PlannedDiff[] = [];
  let i = 0;
  for (const row of all) {
    i++;
    process.stderr.write(`\r[${i}/${all.length}] ${row.sid}     `);

    let sub;
    try {
      sub = await getSubscriber(row.sid.trim());
    } catch (e) {
      console.error(`\n  ! getSubscriber failed for ${row.sid}: ${(e as Error).message}`);
      continue;
    }

    const tagNames = sub.tags
      .map((t) => TAG_NAME_BY_ID.get(t.id))
      .filter((n): n is string => typeof n === "string");

    const patch: Record<string, string> = {};
    if (sub.name) patch["name"] = sub.name;
    for (const f of sub.custom_fields) {
      const name = FIELD_NAME_BY_ID.get(f.id);
      if (!name) continue;
      if (f.value === null || f.value === undefined) continue;
      patch[FIELD_COLUMN[name]] = String(f.value);
    }

    let waJid: string | null = row.currentJid ?? null;
    if (!waJid && sub.phone) {
      try {
        waJid = await resolveJidFromPhone(sub.phone);
      } catch {
        waJid = null;
      }
    }

    plans.push({
      sid: row.sid,
      name: sub.name ?? null,
      phone: sub.phone ?? null,
      wa_jid: waJid,
      tags_to_add: tagNames,
      field_patch: patch,
    });
  }
  process.stderr.write("\n");
  return plans;
}

async function apply(plans: PlannedDiff[]): Promise<void> {
  let writes = 0;
  for (const p of plans) {
    const patch: Record<string, unknown> = { ...p.field_patch };
    if (p.phone) patch.phoneE164 = p.phone;
    if (p.wa_jid) patch.waJid = p.wa_jid;
    patch.updatedAt = new Date();

    await db
      .update(leads)
      .set(patch as any)
      .where(eq(leads.manychatSubId, p.sid));

    if (p.tags_to_add.length > 0) {
      for (const t of p.tags_to_add) {
        await db
          .insert(leadTags)
          .values({ manychatSubId: p.sid, tag: t })
          .onConflictDoNothing();
      }
    }
    writes++;
  }
  console.log(`wrote ${writes} leads`);
}

async function main() {
  console.log(`backfill-from-manychat: ${CONFIRM ? "WRITE" : "DRY RUN"}`);
  const plans = await buildPlan();
  console.log(`\nplanned ${plans.length} updates\n`);
  for (const p of plans.slice(0, 5)) {
    console.log(JSON.stringify(p, null, 2));
  }
  if (plans.length > 5) console.log(`... (${plans.length - 5} more)`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — pass --confirm to apply.");
    return;
  }
  await apply(plans);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
