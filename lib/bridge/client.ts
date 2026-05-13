/**
 * Bridge-backed reimplementation of lib/manychat/client.ts. Same public
 * signature so callers in app/actions/v2.ts, app/api/bot/*, and scripts
 * can swap implementations via lib/messaging.
 *
 * - Tag state and custom field state live in our DB (leads + lead_tags),
 *   not in ManyChat. Reads and writes hit the DB.
 * - Subscriber identity is the WhatsApp JID (e.g. "972…@s.whatsapp.net")
 *   stored on leads.manychatSubId for bridge-origin leads. Callers pass
 *   whatever id is stored — bridge or ManyChat — and we don't reinterpret.
 * - getSubscriber returns the SAME shape as the ManyChat version so the
 *   classifier and dashboard need no changes:
 *     - tags carry numeric ids from TAG_IDS / V2_FLAG_TAG_IDS
 *     - custom_fields carry numeric ids from FIELD_IDS
 *   That keeps getFieldValue(fields, name) working unchanged.
 */
import { db } from "../db";
import { leads, leadTags, messages as messagesTable } from "../../drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { bridgeFetch } from "./http";
import {
  FIELD_IDS,
  TAG_IDS,
  V2_FLAG_TAG_IDS,
  type FieldName,
  type TagName,
  type V2FlagName,
} from "./config";
import { isJid, jidToPhone, phoneToJid } from "./jid";

export interface SubscriberInfo {
  id: string;
  name?: string;
  phone?: string;
  tags: { id: number; name?: string }[];
  custom_fields: { id: number; name?: string; value: string | number | null }[];
}

// ---------- tag id <-> name maps ----------

type AnyTagName = TagName | V2FlagName;

const TAG_NAME_BY_ID = new Map<number, AnyTagName>();
for (const [name, id] of Object.entries(TAG_IDS)) {
  TAG_NAME_BY_ID.set(id as number, name as TagName);
}
for (const [name, id] of Object.entries(V2_FLAG_TAG_IDS)) {
  TAG_NAME_BY_ID.set(id as number, name as V2FlagName);
}

const TAG_ID_BY_NAME = new Map<string, number>();
for (const [id, name] of TAG_NAME_BY_ID) {
  TAG_ID_BY_NAME.set(name, id);
}

function tagIdToName(id: number): AnyTagName | null {
  return TAG_NAME_BY_ID.get(id) ?? null;
}

function tagNameToId(name: string): number | null {
  return TAG_ID_BY_NAME.get(name) ?? null;
}

// ---------- field name -> column map ----------

const FIELD_COLUMN: Record<FieldName, keyof typeof leads.$inferInsert> = {
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

// ---------- public API ----------

// Pre-existing data quirk: some leads.manychat_sub_id values carry a
// trailing space. We can't trim the column in place because trimmed
// versions of some IDs already exist as separate rows (would collide on
// PK). So every lookup uses trim()=trim() instead of equality so callers
// can pass either form.
function sidMatch(sid: string) {
  return sql`trim(${leads.manychatSubId}) = ${sid.trim()}`;
}

function tagSidMatch(sid: string) {
  return sql`trim(${leadTags.manychatSubId}) = ${sid.trim()}`;
}

export async function getSubscriber(subscriberId: string): Promise<SubscriberInfo> {
  const sid = subscriberId.trim();
  const [row] = await db
    .select()
    .from(leads)
    .where(sidMatch(sid))
    .limit(1);

  if (!row) {
    return {
      id: sid,
      name: undefined,
      phone: undefined,
      tags: [],
      custom_fields: [],
    };
  }

  const tagRows = await db
    .select({ tag: leadTags.tag })
    .from(leadTags)
    .where(tagSidMatch(sid));

  const tags = tagRows
    .map((t) => {
      const id = tagNameToId(t.tag);
      return id ? { id, name: t.tag } : null;
    })
    .filter((t): t is { id: number; name: string } => t !== null);

  const phone =
    row.phoneE164 ??
    (row.waJid && !row.waJid.endsWith("@lid") ? jidToPhone(row.waJid) ?? undefined : undefined) ??
    undefined;

  const fieldValues: SubscriberInfo["custom_fields"] = [];
  for (const [name, fieldId] of Object.entries(FIELD_IDS) as [FieldName, number][]) {
    const col = FIELD_COLUMN[name];
    const value = (row as any)[col] as string | null | undefined;
    if (value === null || value === undefined) continue;
    fieldValues.push({ id: fieldId, name, value });
  }

  return {
    id: sid,
    name: row.name ?? undefined,
    phone,
    tags,
    custom_fields: fieldValues,
  };
}

export async function addTag(subscriberId: string, tagId: number): Promise<void> {
  const sid = subscriberId.trim();
  const name = tagIdToName(tagId);
  if (!name) {
    throw new Error(`addTag: unknown tag id ${tagId}`);
  }
  // Check by trimmed match — pre-existing rows may carry trailing spaces.
  const existing = await db
    .select({ id: leadTags.id })
    .from(leadTags)
    .where(and(tagSidMatch(sid), eq(leadTags.tag, name)))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(leadTags).values({ manychatSubId: sid, tag: name });
}

export async function removeTag(subscriberId: string, tagId: number): Promise<void> {
  const sid = subscriberId.trim();
  const name = tagIdToName(tagId);
  if (!name) {
    throw new Error(`removeTag: unknown tag id ${tagId}`);
  }
  await db
    .delete(leadTags)
    .where(and(tagSidMatch(sid), eq(leadTags.tag, name)));
}

export async function setCustomFields(
  subscriberId: string,
  fields: { name: FieldName; value: string | number }[]
): Promise<void> {
  const sid = subscriberId.trim();
  if (fields.length === 0) return;
  const patch: Record<string, string> = {};
  for (const f of fields) {
    const col = FIELD_COLUMN[f.name];
    if (!col) continue;
    patch[col as string] = String(f.value);
  }
  if (Object.keys(patch).length === 0) return;
  await db
    .update(leads)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(sidMatch(sid));
}

export function getFieldValue(
  fields: SubscriberInfo["custom_fields"],
  name: FieldName
): string | number | null {
  const id = FIELD_IDS[name];
  return fields.find((f) => f.id === id)?.value ?? null;
}

export async function getActiveSubscriberIds(): Promise<string[]> {
  const rows = await db
    .select({ id: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.active, true));
  return rows.map((r) => r.id);
}

// ---------- bridge-only extras (outbound WhatsApp + JID resolution) ----------

export interface BridgeSendResult {
  wa_message_id: string;
  status?: string;
}

export async function sendBridgeMessage(
  recipient: string,
  message: string,
  mediaPath?: string
): Promise<BridgeSendResult> {
  // Test-only escape hatch — skips the actual WhatsApp send and returns a
  // fake message id. Set BRIDGE_DRY_RUN=1 in local test scripts (see
  // scripts/test-stage*.ts). NEVER set this in Vercel/prod.
  if (process.env.BRIDGE_DRY_RUN === "1") {
    const fakeId = `dryrun:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const preview = message.length > 100 ? `${message.slice(0, 100)}…` : message;
    console.log(`[bridge.dryrun] → ${recipient}: ${preview.replace(/\n/g, " ⏎ ")}`);
    return { wa_message_id: fakeId, status: "dryrun" };
  }
  const body: Record<string, unknown> = {
    recipient: isJid(recipient) ? recipient : phoneToJid(recipient),
    message,
  };
  if (mediaPath) body.media_path = mediaPath;
  return bridgeFetch<BridgeSendResult>("/v1/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function resolveJidFromPhone(phone: string): Promise<string | null> {
  const digits = String(phone).replace(/[^0-9]/g, "");
  if (!digits) return null;
  try {
    const res = await bridgeFetch<{ jid?: string; lid?: string }>(
      `/v1/lid/resolve?phone=${digits}`
    );
    return res.jid ?? res.lid ?? `${digits}@s.whatsapp.net`;
  } catch {
    return `${digits}@s.whatsapp.net`;
  }
}

// Internal helper used by the bridge webhook handler. Exported so the
// route file does not have to import schema directly.
export async function upsertLeadFromBridgeEvent(input: {
  jid: string;
  name?: string;
  phone?: string;
  source?: string;
}): Promise<void> {
  const sid = input.jid;
  await db
    .insert(leads)
    .values({
      manychatSubId: sid,
      waJid: sid,
      phoneE164: input.phone ?? null,
      name: input.name ?? null,
      source: input.source ?? "bridge_webhook",
      active: true,
    })
    .onConflictDoUpdate({
      target: leads.manychatSubId,
      set: {
        waJid: sid,
        ...(input.name ? { name: input.name } : {}),
        ...(input.phone ? { phoneE164: input.phone } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function insertBridgeMessage(input: {
  jid: string;
  direction: "in" | "out";
  text: string | null;
  waMessageId: string;
  payload: unknown;
  receivedAt?: Date;
}): Promise<{ id: number } | null> {
  // Dedupe by waMessageId — webhooks can retry.
  const existing = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.waMessageId, input.waMessageId))
    .limit(1);
  if (existing.length > 0) return null;

  const [row] = await db
    .insert(messagesTable)
    .values({
      manychatSubId: input.jid,
      direction: input.direction,
      text: input.text,
      payload: input.payload as any,
      waMessageId: input.waMessageId,
      ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
    })
    .returning({ id: messagesTable.id });
  return row;
}
