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
import { BridgeError, bridgeFetch } from "./http";
import {
  BRIDGE_BASE,
  FIELD_IDS,
  TAG_IDS,
  V2_FLAG_TAG_IDS,
  requireBridgeToken,
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
  mediaPath?: string,
  // Sender attribution for the pre-inserted outbound `messages` row. Default
  // 'bot' covers the autoresponder/cron/draft-approve paths; pass 'eli' from
  // sendManualReply (dashboard) so manual replies are tagged correctly.
  sender: "bot" | "eli" = "bot",
  // Optional override for the filename WhatsApp shows on a document
  // attachment. When omitted, derived from the URL pathname (often a route
  // segment like `pdf` rather than a real filename).
  mediaFilename?: string,
  // Optional WhatsApp interactive buttons (max 3). When present the bridge
  // sends `type: "buttons"` — `message` becomes the body text, each entry
  // becomes a tappable reply chip.
  buttons?: { id: string; title: string }[],
  // Optional WhatsApp native poll (2..12 options). When present the bridge
  // sends `type: "poll"` — `message` is ignored on the wire (we keep it for
  // the outbound DB row text) and `poll.question` is what WhatsApp displays
  // above the options. Vote replies arrive as a webhook `message.received`
  // with `data.media_type="poll_vote"` and JSON content carrying
  // `selected_options[]`. See app/api/bridge/webhook/route.ts.
  poll?: { question: string; options: string[]; selectableCount?: number }
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
  const jid = isJid(recipient) ? recipient : phoneToJid(recipient);
  const body: Record<string, unknown> = { recipient: jid };
  if (poll && poll.options.length >= 2) {
    if (poll.options.length > 12) {
      throw new Error(
        `sendBridgeMessage: WhatsApp poll capped at 12 options — got ${poll.options.length}`
      );
    }
    body.type = "poll";
    body.question = poll.question;
    body.options = poll.options;
    body.selectable_count = poll.selectableCount ?? 1;
  } else if (buttons && buttons.length > 0) {
    if (buttons.length > 3) {
      throw new Error(
        `sendBridgeMessage: WhatsApp buttons capped at 3 — got ${buttons.length}`
      );
    }
    // Bridge interactive shape (from /v1/discovery): type=buttons uses `body`
    // for the prompt text, NOT `message`. Each button is { id, title }.
    body.type = "buttons";
    body.body = message;
    body.buttons = buttons;
  } else {
    body.message = message;
  }
  if (mediaPath) {
    // Bridge requires media to be staged via POST /v1/media first; send with
    // `media_id`. `media_url` is not supported. We download the URL here, push
    // the bytes to /v1/media, and reference the returned media_id.
    const isUrl = /^https?:\/\//i.test(mediaPath);
    if (isUrl) {
      const mediaId = await uploadBridgeMediaFromUrl(mediaPath, mediaFilename);
      body.media_id = mediaId;
    } else {
      // Local-path callers (rare) can still pass media_path; bridge supports
      // both modes per discovery: "media (media_id|media_path)".
      body.media_path = mediaPath;
    }
  }
  const result = await bridgeFetch<BridgeSendResult>("/v1/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Pre-insert the outbound row with sender attribution before the bridge's
  // `message.sent` webhook fires. The webhook's insertBridgeMessage dedupes
  // by waMessageId so this is the first writer; manual sends from the WA
  // Business app skip this path and reach the webhook with sender='eli'.
  try {
    await insertBridgeMessage({
      jid,
      direction: "out",
      text: message,
      waMessageId: result.wa_message_id,
      payload: { from: "sendBridgeMessage", mediaPath: mediaPath ?? null },
      sender,
    });
  } catch (e) {
    console.warn("[sendBridgeMessage] outbound pre-insert failed", e);
  }

  return result;
}

interface BridgeMediaUpload {
  media_id: string;
  kind: string;
  mimetype: string;
  size: number;
  filename: string;
}

/**
 * Download a remote URL and push the bytes into the bridge's media store via
 * POST /v1/media (raw body, NOT JSON). Returns the staged media_id, which
 * /v1/messages will accept under the `media_id` field.
 */
async function uploadBridgeMediaFromUrl(
  url: string,
  filenameOverride?: string
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`uploadBridgeMediaFromUrl: fetch ${url} → ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const mimetype = res.headers.get("content-type") || "application/octet-stream";
  // Filename WhatsApp shows on the document tile. Prefer the caller's override
  // (e.g. "quote-XYZ.pdf") so it reads as a real file; fall back to the URL's
  // last path segment, which for app routes is usually just the segment name.
  const pathname = new URL(url).pathname;
  const filename =
    filenameOverride ||
    pathname.split("/").filter(Boolean).pop()?.split("?")[0] ||
    "file.bin";

  const upRes = await fetch(
    `${BRIDGE_BASE}/v1/media?filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireBridgeToken()}`,
        "Content-Type": mimetype,
      },
      body: buf,
    }
  );
  const text = await upRes.text();
  if (!upRes.ok) {
    throw new Error(
      `uploadBridgeMediaFromUrl: bridge /v1/media → ${upRes.status} ${text.slice(0, 200)}`
    );
  }
  const json = JSON.parse(text) as BridgeMediaUpload;
  return json.media_id;
}

export interface BridgeContact {
  jid: string;
  pn: string | null;
  name: string | null;
  notify: string | null;
  username: string | null;
  verified_name?: string | null;
}

/**
 * Fetch contact info from the bridge for a given JID. Bridge stores contact
 * metadata separately from message events; this is how we learn the phone +
 * push name for a @lid identifier. Returns null on 404 (no contact row yet).
 */
export async function fetchBridgeContact(jid: string): Promise<BridgeContact | null> {
  try {
    return await bridgeFetch<BridgeContact>(
      `/v1/contacts/${encodeURIComponent(jid)}`
    );
  } catch (e: unknown) {
    if (e instanceof BridgeError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Extract a clean E.164-without-plus phone string from the bridge contact's
 * `pn` field (which carries the WhatsApp `<digits>@s.whatsapp.net` form).
 */
export function phoneFromBridgePn(pn: string | null | undefined): string | null {
  if (!pn) return null;
  const digits = pn.split("@")[0]?.replace(/[^0-9]/g, "") ?? "";
  return digits || null;
}

/**
 * Pick the best human-facing name from a bridge contact. Prefers the
 * verified WA business name, then the contact's own `name`, then the push
 * name that other users see. Returns null if none are usable.
 */
export function nameFromBridgeContact(c: BridgeContact | null): string | null {
  if (!c) return null;
  for (const candidate of [c.verified_name, c.name, c.notify, c.username]) {
    const v = candidate?.trim();
    if (v) return v;
  }
  return null;
}

export async function resolveJidFromPhone(phone: string): Promise<string | null> {
  const digits = String(phone).replace(/[^0-9]/g, "");
  if (!digits) return null;
  try {
    const res = await bridgeFetch<{ jid?: string; lid?: string }>(
      `/v1/lid/resolve?phone=${digits}`
    );
    // If bridge returns a LID (numeric, no suffix), append @lid so callers
    // don't mistake it for a phone number and convert it to @s.whatsapp.net.
    if (res.jid) return res.jid;
    if (res.lid) return res.lid.includes("@") ? res.lid : `${res.lid}@lid`;
    return `${digits}@s.whatsapp.net`;
  } catch {
    return `${digits}@s.whatsapp.net`;
  }
}

// Internal helper used by the bridge webhook handler. Exported so the
// route file does not have to import schema directly.
//
// On insert (or when the existing row still has null name/phone) we hit the
// bridge `/v1/contacts/<jid>` endpoint to enrich. Bridge events themselves
// do not carry name/phone for @lid JIDs — the contact metadata lives on a
// separate resource that we have to pull explicitly. We swallow errors so a
// transient bridge hiccup never breaks message ingestion.
export async function upsertLeadFromBridgeEvent(input: {
  jid: string;
  name?: string;
  phone?: string;
  source?: string;
}): Promise<void> {
  const sid = input.jid;

  let enrichedName = input.name ?? null;
  let enrichedPhone = input.phone ?? null;

  if (!enrichedName || !enrichedPhone) {
    try {
      const contact = await fetchBridgeContact(sid);
      if (contact) {
        enrichedName = enrichedName ?? nameFromBridgeContact(contact);
        enrichedPhone = enrichedPhone ?? phoneFromBridgePn(contact.pn);
      }
    } catch (e) {
      console.warn("[upsertLeadFromBridgeEvent] contact fetch failed", sid, e);
    }
  }

  await db
    .insert(leads)
    .values({
      manychatSubId: sid,
      waJid: sid,
      phoneE164: enrichedPhone,
      name: enrichedName,
      source: input.source ?? "bridge_webhook",
      active: true,
    })
    .onConflictDoUpdate({
      target: leads.manychatSubId,
      set: {
        waJid: sid,
        // coalesce preserves any value Eli set manually — bridge only fills
        // in fields that are still null in the DB.
        name: sql`coalesce(${leads.name}, ${enrichedName})`,
        phoneE164: sql`coalesce(${leads.phoneE164}, ${enrichedPhone})`,
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
  // 'lead' for inbound; for outbound: 'bot' when our own code initiated
  // the send (pre-insert before bridge.sent fires), 'eli' when the bridge
  // reports an outbound we did not originate (manual reply from WA Business
  // app). null = legacy / unknown.
  sender?: "lead" | "bot" | "eli" | null;
}): Promise<{ id: number } | null> {
  // Dedupe by waMessageId — webhooks can retry, and our own pre-insert from
  // approveDraft / sendManualReply / autoresponder paths will already have
  // claimed this id with sender='bot' or 'eli'.
  //
  // RACE: the bridge sometimes fires `message.sent` BEFORE our POST /v1/messages
  // call returns the wa_message_id, so the webhook can insert a placeholder
  // row with text=null first. When the slower path (sendBridgeMessage) then
  // tries to pre-insert with the real text, we must PATCH the existing row
  // rather than no-op — otherwise the conversation thread shows empty bot
  // bubbles forever. The patch only writes a field when the new value is
  // strictly more informative than the existing one.
  const existing = await db
    .select({
      id: messagesTable.id,
      text: messagesTable.text,
      sender: messagesTable.sender,
    })
    .from(messagesTable)
    .where(eq(messagesTable.waMessageId, input.waMessageId))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    const patch: Record<string, unknown> = {};
    if (
      input.text &&
      input.text.trim().length > 0 &&
      (!row.text || row.text.trim().length === 0)
    ) {
      patch.text = input.text;
    }
    // 'bot' / 'lead' are more specific than the webhook's default 'eli'
    // fallback for outbound — overwrite when we have stronger evidence.
    if (
      input.sender &&
      input.sender !== row.sender &&
      (row.sender === null || (row.sender === "eli" && input.sender === "bot"))
    ) {
      patch.sender = input.sender;
    }
    if (Object.keys(patch).length > 0) {
      await db
        .update(messagesTable)
        .set(patch as any)
        .where(eq(messagesTable.id, row.id));
    }
    return null;
  }

  // Resolve JID → canonical lead.manychat_sub_id when a matching lead exists.
  // The leads table is keyed by manychat_sub_id (which is a JID for
  // bridge-origin leads but a numeric ManyChat id for legacy ManyChat-origin
  // leads). Messages must be keyed the same way the lead is, otherwise the
  // dashboard groups them under a raw JID conversation that's orphaned from
  // the lead row (no name, no stage, no notes).
  const lead = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.waJid, input.jid))
    .limit(1);
  const conversationKey = lead[0]?.sid ?? input.jid;

  const [row] = await db
    .insert(messagesTable)
    .values({
      manychatSubId: conversationKey,
      direction: input.direction,
      text: input.text,
      payload: input.payload as any,
      waMessageId: input.waMessageId,
      ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
      ...(input.sender !== undefined ? { sender: input.sender } : {}),
    } as any)
    .returning({ id: messagesTable.id });
  return row;
}
