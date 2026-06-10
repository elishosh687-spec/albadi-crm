// Server-only GHL (GoHighLevel) REST V2 client.
// Docs: https://highlevel.stoplight.io/docs/integrations/

import {
  GHL_BASE,
  GHL_API_VERSION,
  requireGHLToken,
  requireGHLLocationId,
} from "./config";
import { getValidAccessToken } from "./oauth";

type Query = Record<string, string | number | boolean | undefined>;

// Tiny in-process cache so we don't hit the DB on every ghlFetch call.
// OAuth access tokens are 24h; we cache for 60s to balance freshness vs load.
let oauthCache: { token: string; expiresAt: number } | null = null;
async function resolveDefaultToken(): Promise<string> {
  const now = Date.now();
  if (oauthCache && oauthCache.expiresAt > now) return oauthCache.token;
  try {
    const locationId = requireGHLLocationId();
    const tok = await getValidAccessToken(locationId);
    if (tok) {
      oauthCache = { token: tok, expiresAt: now + 60_000 };
      return tok;
    }
  } catch {
    // fall through to PIT
  }
  // Fallback to PIT if OAuth not set up (legacy).
  return requireGHLToken();
}

async function ghlFetch<T = unknown>(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
  query?: Query
): Promise<T> {
  const url = new URL(GHL_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers = new Headers(init.headers);
  const token = init.accessToken ?? (await resolveDefaultToken());
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Version", GHL_API_VERSION);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url.toString(), { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Throw a structured error so callers (and the mirror audit log) can
    // inspect status/body without parsing the message string.
    const err = new Error(
      `GHL ${init.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 500)}`
    ) as Error & { status?: number; responseBody?: string; ghlPath?: string };
    err.status = res.status;
    err.responseBody = body;
    err.ghlPath = path;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ===========================================================================
// Types
// ===========================================================================

export interface GHLCustomFieldValue {
  id: string;
  // GHL accepts string for TEXT/LARGE_TEXT, number for NUMERICAL/MONETARY,
  // ISO date for DATE, boolean for CHECKBOX. We send a stringified version
  // and let GHL coerce — type=any to keep callers simple.
  value: string | number | boolean | null;
  // For some field types GHL also accepts `key`. Not used here.
}

export interface GHLContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  customFields?: Array<{ id: string; value: unknown }>;
  tags?: string[];
}

export interface GHLContactUpsertInput {
  locationId?: string; // defaults to requireGHLLocationId()
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  tags?: string[];
  customFields?: GHLCustomFieldValue[];
}

export interface GHLContactUpsertResponse {
  new: boolean;
  contact: GHLContact;
}

export interface GHLPipeline {
  id: string;
  name: string;
  stages: GHLPipelineStage[];
}

export interface GHLPipelineStage {
  id: string;
  name: string;
  position: number;
}

export interface GHLOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: "open" | "won" | "lost" | "abandoned";
  contactId: string;
  monetaryValue?: number;
  source?: string;
  customFields?: Array<{ id: string; fieldValue: unknown }>;
}

export interface GHLOpportunityCreateInput {
  pipelineId: string;
  pipelineStageId: string;
  locationId?: string;
  name: string;
  contactId: string;
  status?: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
  source?: string;
  customFields?: GHLCustomFieldValue[];
}

export interface GHLOpportunityUpdateInput {
  pipelineId?: string;
  pipelineStageId?: string;
  name?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
  customFields?: GHLCustomFieldValue[];
}

export interface GHLCustomField {
  id: string;
  name: string;
  fieldKey?: string;
  dataType: string;
  model: "contact" | "opportunity";
}

// ===========================================================================
// Contacts
// ===========================================================================

/**
 * Idempotent contact upsert by phone. GHL dedupes by phone within a
 * location. If the contact exists, custom fields and tags are merged.
 */
export async function upsertContact(
  input: GHLContactUpsertInput
): Promise<GHLContactUpsertResponse> {
  const body = {
    locationId: input.locationId ?? requireGHLLocationId(),
    firstName: input.firstName,
    lastName: input.lastName,
    name: input.name,
    phone: input.phone,
    email: input.email,
    source: input.source ?? "whatsapp-bridge",
    tags: input.tags,
    customFields: input.customFields,
  };
  return ghlFetch<GHLContactUpsertResponse>("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Find a contact by phone (E.164). Returns null if no match.
 */
export async function findContactByPhone(
  phoneE164: string
): Promise<GHLContact | null> {
  try {
    const res = await ghlFetch<{ contact?: GHLContact }>(
      "/contacts/search/duplicate",
      undefined,
      {
        locationId: requireGHLLocationId(),
        number: phoneE164,
      }
    );
    return res.contact ?? null;
  } catch (err) {
    // 404 from duplicate-search just means "no dup" — treat as null.
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

export async function getContact(contactId: string): Promise<GHLContact> {
  const res = await ghlFetch<{ contact: GHLContact }>(
    `/contacts/${contactId}`
  );
  return res.contact;
}

export async function updateContact(
  contactId: string,
  patch: Partial<GHLContactUpsertInput>
): Promise<GHLContact> {
  const res = await ghlFetch<{ contact: GHLContact }>(
    `/contacts/${contactId}`,
    {
      method: "PUT",
      body: JSON.stringify(patch),
    }
  );
  return res.contact;
}

// ===========================================================================
// Pipelines + stages
// ===========================================================================

export async function listPipelines(): Promise<GHLPipeline[]> {
  const res = await ghlFetch<{ pipelines: GHLPipeline[] }>(
    "/opportunities/pipelines",
    undefined,
    { locationId: requireGHLLocationId() }
  );
  return res.pipelines ?? [];
}

/**
 * Create a new pipeline with stages.
 *
 * NOTE: Pipeline CREATE via the public V2 API is account-tier dependent.
 * Some sub-accounts get 404 / 403 here. If so, the caller should fall back
 * to creating the pipeline in the GHL UI.
 */
export async function createPipeline(input: {
  name: string;
  stages: Array<{ name: string; position: number }>;
}): Promise<GHLPipeline> {
  const body = {
    name: input.name,
    locationId: requireGHLLocationId(),
    stages: input.stages,
  };
  const res = await ghlFetch<{ pipeline: GHLPipeline }>(
    "/opportunities/pipelines",
    { method: "POST", body: JSON.stringify(body) }
  );
  return res.pipeline;
}

// ===========================================================================
// Opportunities
// ===========================================================================

export async function createOpportunity(
  input: GHLOpportunityCreateInput
): Promise<GHLOpportunity> {
  const body = {
    ...input,
    locationId: input.locationId ?? requireGHLLocationId(),
    status: input.status ?? "open",
  };
  const res = await ghlFetch<{ opportunity: GHLOpportunity }>(
    "/opportunities/",
    { method: "POST", body: JSON.stringify(body) }
  );
  return res.opportunity;
}

export async function updateOpportunity(
  opportunityId: string,
  patch: GHLOpportunityUpdateInput
): Promise<GHLOpportunity> {
  const res = await ghlFetch<{ opportunity: GHLOpportunity }>(
    `/opportunities/${opportunityId}`,
    { method: "PUT", body: JSON.stringify(patch) }
  );
  return res.opportunity;
}

export async function getOpportunity(
  opportunityId: string
): Promise<GHLOpportunity> {
  const res = await ghlFetch<{ opportunity: GHLOpportunity }>(
    `/opportunities/${opportunityId}`
  );
  return res.opportunity;
}

/**
 * Find a single opportunity for a contact within the configured pipeline.
 * Returns the most-recently-updated open opportunity if multiple exist.
 */
export async function findOpportunityForContact(
  contactId: string,
  pipelineId: string
): Promise<GHLOpportunity | null> {
  const res = await ghlFetch<{ opportunities?: GHLOpportunity[] }>(
    "/opportunities/search",
    undefined,
    {
      location_id: requireGHLLocationId(),
      pipeline_id: pipelineId,
      contact_id: contactId,
      limit: 1,
    }
  );
  return res.opportunities?.[0] ?? null;
}

// ===========================================================================
// Custom fields
// ===========================================================================

export async function listLocationCustomFields(
  model: "contact" | "opportunity" = "contact"
): Promise<GHLCustomField[]> {
  const res = await ghlFetch<{ customFields: GHLCustomField[] }>(
    `/locations/${requireGHLLocationId()}/customFields`,
    undefined,
    { model }
  );
  return res.customFields ?? [];
}

export async function createLocationCustomField(input: {
  name: string;
  dataType: string;
  model?: "contact" | "opportunity";
  placeholder?: string;
  position?: number;
}): Promise<GHLCustomField> {
  const res = await ghlFetch<{ customField: GHLCustomField }>(
    `/locations/${requireGHLLocationId()}/customFields`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        dataType: input.dataType,
        model: input.model ?? "contact",
        placeholder: input.placeholder ?? "",
        position: input.position,
      }),
    }
  );
  return res.customField;
}

// ===========================================================================
// Notes (used for activity log / message mirroring as fallback)
// ===========================================================================

// ===========================================================================
// Conversation Providers (Custom channel for Phase 1F outbound)
// ===========================================================================

export interface GHLConversationProvider {
  id: string;
  name: string;
  alias?: string;
  type: string;
  locationId: string;
  deliveryUrl?: string;
  active?: boolean;
}

/**
 * Register (or look up) a Custom Conversation Provider. GHL routes outbound
 * messages typed with `conversationProviderId = <this.id>` through the
 * provider's deliveryUrl webhook.
 *
 * Idempotent by name within a location: if a provider with the same name
 * exists, returns it instead of creating a duplicate.
 */
export async function upsertConversationProvider(input: {
  name: string;
  deliveryUrl: string;
  alias?: string;
  type?: "Custom" | "SMS" | "Email";
  accessToken?: string; // OAuth token (required — PIT lacks providers.write)
}): Promise<GHLConversationProvider> {
  const locationId = requireGHLLocationId();
  const auth = input.accessToken ? { accessToken: input.accessToken } : {};
  // Look up existing first.
  try {
    const existing = await ghlFetch<{ providers?: GHLConversationProvider[] }>(
      "/conversations/providers",
      auth,
      { locationId }
    );
    const match = existing.providers?.find(
      (p) => p.name === input.name && p.locationId === locationId
    );
    if (match) return match;
  } catch {
    // List endpoint may 404 on accounts with no providers — fall through to create.
  }
  const body = {
    locationId,
    name: input.name,
    alias: input.alias ?? input.name.toLowerCase().replace(/\s+/g, "_"),
    type: input.type ?? "Custom",
    deliveryUrl: input.deliveryUrl,
    active: true,
  };
  const res = await ghlFetch<{ provider: GHLConversationProvider }>(
    "/conversations/providers",
    { method: "POST", body: JSON.stringify(body), ...auth }
  );
  return res.provider;
}

// ===========================================================================
// Medias — upload file to GHL hosting (Phase 1F media support)
// ===========================================================================

/**
 * Upload a media file to GHL's `/medias/upload-file` endpoint. Returns the
 * hosted URL we can pass as `attachments[]` to /conversations/messages so
 * GHL renders the media inline with correct MIME (audio/video/image).
 *
 * Requires OAuth token (PIT lacks medias.write scope on this endpoint).
 */
export async function uploadMediaFromUrl(input: {
  url: string;
  filename: string;
  mimeType?: string;
  accessToken: string;
}): Promise<{ url: string; fileId?: string }> {
  // GHL /medias/upload-file expects a multipart form with `fileUrl`
  // (string — GHL fetches the file itself) NOT a binary file field.
  // Whitelist is path-extension based, so the URL path must end with a
  // supported extension (.ogg/.mp3/.mp4/.jpg/.png/.pdf …).
  const form = new FormData();
  form.append("fileUrl", input.url);
  form.append("locationId", requireGHLLocationId());
  form.append("hosted", "true");
  form.append("name", input.filename);

  const res = await fetch(`${GHL_BASE}/medias/upload-file`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Version: GHL_API_VERSION,
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `uploadMediaFromUrl: GHL /medias/upload-file → ${res.status} ${text.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { fileId?: string; url?: string };
  if (!json.url) {
    throw new Error(
      `uploadMediaFromUrl: response missing url — ${JSON.stringify(json)}`
    );
  }
  return { url: json.url, fileId: json.fileId };
}

export interface GHLContactNote {
  id: string;
  body: string;
  userId?: string;
  contactId?: string;
  dateAdded?: string;
}

export async function listContactNotes(
  contactId: string
): Promise<GHLContactNote[]> {
  const res = await ghlFetch<{ notes?: GHLContactNote[] }>(
    `/contacts/${contactId}/notes`
  );
  return res.notes ?? [];
}

export async function addContactNote(
  contactId: string,
  body: string,
  userId?: string
): Promise<{ id: string }> {
  const res = await ghlFetch<{ note: { id: string } }>(
    `/contacts/${contactId}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ body, userId }),
    }
  );
  return { id: res.note.id };
}

// ===========================================================================
// Conversations / messages (preferred over notes for chat mirroring)
// ===========================================================================
//
// GHL exposes inbound message ingestion via the Conversations Provider API.
// For the POC we use the simpler `/conversations/messages/inbound` endpoint
// which stamps a message onto the contact's conversation timeline.

export async function postInboundMessage(input: {
  contactId: string;
  message: string;
  attachments?: string[];
  // GHL message type — defaults to SMS so it shows up in the timeline. For
  // custom WhatsApp channels, switch to "CUSTOM" + conversationProviderId.
  type?: "SMS" | "WhatsApp" | "Email" | "Custom";
  conversationProviderId?: string;
  // OAuth access token — required when type=CUSTOM (PIT lacks provider access).
  accessToken?: string;
}): Promise<{ messageId?: string; conversationId?: string }> {
  const body: Record<string, unknown> = {
    type: input.type ?? "SMS",
    contactId: input.contactId,
    message: input.message,
    attachments: input.attachments,
    direction: "inbound",
  };
  if (input.conversationProviderId) {
    body.conversationProviderId = input.conversationProviderId;
  }
  const init: RequestInit & { accessToken?: string } = {
    method: "POST",
    body: JSON.stringify(body),
  };
  if (input.accessToken) init.accessToken = input.accessToken;
  return ghlFetch("/conversations/messages/inbound", init);
}

export async function postOutboundMessage(input: {
  contactId: string;
  message: string;
  type?: "SMS" | "WhatsApp" | "Email" | "Custom";
  conversationProviderId?: string;
  attachments?: string[];
  accessToken?: string;
}): Promise<{ messageId?: string; conversationId?: string }> {
  // Routes through /conversations/messages so the GHL Inbox UI renders the
  // bubble with the right styling/source. The /inbound endpoint accepts
  // direction:"outbound" and stores the message, but the Inbox UI hides
  // outbound entries whose source is "api" coming from the inbound path —
  // they exist in the conversation but never display.
  //
  // GHL responds to /conversations/messages by also firing the Custom
  // Provider deliveryUrl webhook to actually deliver via the provider.
  // For us that webhook is /api/integrations/outbound, which would re-send
  // the same text via Green API and duplicate the customer-facing message.
  // The loop is blocked by the 60-second text+contact dedup in that route
  // — see app/api/integrations/outbound/route.ts.
  const body: Record<string, unknown> = {
    type: input.type ?? "SMS",
    contactId: input.contactId,
    message: input.message,
  };
  if (input.attachments && input.attachments.length > 0) {
    body.attachments = input.attachments;
  }
  if (input.conversationProviderId) {
    body.conversationProviderId = input.conversationProviderId;
  }
  const init: RequestInit & { accessToken?: string } = {
    method: "POST",
    body: JSON.stringify(body),
  };
  if (input.accessToken) init.accessToken = input.accessToken;
  return ghlFetch("/conversations/messages", init);
}

// ===========================================================================
// Contact tasks
// ===========================================================================

export interface GHLContactTask {
  id: string;
  title: string;
  body?: string;
  dueDate: string; // ISO
  completed: boolean;
  assignedTo?: string | null;
  contactId: string;
}

export interface GHLContactTaskInput {
  title: string;
  body?: string;
  dueDate: string; // ISO 8601
  completed?: boolean;
  assignedTo?: string | null;
}

/**
 * Create a task on a contact. GHL stores tasks as first-class records
 * attached to a contact — visible in the contact's Tasks tab and in the
 * global Tasks page.
 */
export async function createContactTask(
  contactId: string,
  input: GHLContactTaskInput
): Promise<GHLContactTask> {
  const body: Record<string, unknown> = {
    title: input.title,
    dueDate: input.dueDate,
    completed: input.completed ?? false,
  };
  if (input.body) body.body = input.body;
  if (input.assignedTo) body.assignedTo = input.assignedTo;
  const res = await ghlFetch<{ task: GHLContactTask }>(
    `/contacts/${contactId}/tasks/`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return res.task;
}

export async function updateContactTask(
  contactId: string,
  taskId: string,
  patch: Partial<GHLContactTaskInput>
): Promise<GHLContactTask> {
  const res = await ghlFetch<{ task: GHLContactTask }>(
    `/contacts/${contactId}/tasks/${taskId}`,
    { method: "PUT", body: JSON.stringify(patch) }
  );
  return res.task;
}

export async function deleteContactTask(
  contactId: string,
  taskId: string
): Promise<void> {
  await ghlFetch(`/contacts/${contactId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function listContactTasks(
  contactId: string
): Promise<GHLContactTask[]> {
  const res = await ghlFetch<{ tasks?: GHLContactTask[] }>(
    `/contacts/${contactId}/tasks`
  );
  return res.tasks ?? [];
}

export async function listOpportunitiesForContact(
  contactId: string
): Promise<GHLOpportunity[]> {
  const res = await ghlFetch<{ opportunities?: GHLOpportunity[] }>(
    "/opportunities/search",
    undefined,
    {
      location_id: requireGHLLocationId(),
      contact_id: contactId,
      limit: 20,
    }
  );
  return res.opportunities ?? [];
}

// ===========================================================================
// Contact tags (add/remove by name)
// ===========================================================================

export async function addContactTags(
  contactId: string,
  tags: string[]
): Promise<void> {
  if (tags.length === 0) return;
  await ghlFetch(`/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

export async function removeContactTags(
  contactId: string,
  tags: string[]
): Promise<void> {
  if (tags.length === 0) return;
  await ghlFetch(`/contacts/${contactId}/tags`, {
    method: "DELETE",
    body: JSON.stringify({ tags }),
  });
}

// ===========================================================================
// Call recordings — list calls + download audio for the
// /api/bot/process-recordings pipeline.
// ===========================================================================
//
// GHL stores calls as `messages` of type `TYPE_CALL` (numeric id may vary —
// observed values: 3 for call, sometimes returned as string "TYPE_CALL").
// We accept both shapes when filtering downstream.
//
// API surface used:
//   - GET /conversations/messages/search   — location-level search across
//     all conversations for messages matching the type/date filter.
//   - GET /conversations/messages/{id}/locations/{locationId}/recording
//     — returns the audio binary directly (not a redirect URL).

export interface GHLCallMessage {
  id: string;
  conversationId: string;
  contactId?: string;
  locationId?: string;
  /** Numeric or string form, depending on GHL version. */
  type?: number | string;
  /** Specific to call-type messages — direction/status/duration metadata. */
  meta?: {
    call?: {
      status?:
        | "completed"
        | "voicemail"
        | "busy"
        | "no-answer"
        | "failed"
        | string;
      duration?: number; // seconds
      direction?: "inbound" | "outbound" | string;
      recordingUrl?: string;
    };
  };
  dateAdded?: string;
  dateUpdated?: string;
  body?: string;
  attachments?: Array<{ url?: string; type?: string }>;
}

export interface SearchCallMessagesOpts {
  /** ISO timestamp. Polls with overlap = (cursor − 30min). */
  startAfterDate?: string;
  /** Soft cap. GHL returns up to 100 per page; we paginate inside. */
  limit?: number;
}

/**
 * List recent call messages across the location.
 *
 * GHL's `/conversations/messages/search` doesn't accept a type filter
 * (422 "type must be a valid enum value" — empirically confirmed 2026-06).
 * So we go two-stage:
 *   1. /conversations/search → newest N conversations (no type filter — see below)
 *   2. /conversations/{id}/messages → fetch each conversation's messages,
 *      keep only the call-type ones (type === 1 / "TYPE_CALL" / meta.call set)
 *
 * **Why no `lastMessageType=TYPE_CALL`:** that filter only returns
 * conversations whose most recent message is a call. But in this codebase
 * the bot sends a WhatsApp follow-up after every call, which immediately
 * flips lastMessageType to TYPE_CUSTOM_PROVIDER_SMS — so the call message
 * becomes invisible to the filter. We learned this the hard way on
 * 2026-06-09 (moshe / 972505646052 / a 700-second call we missed).
 *
 * Trade-off: scanning newest 100 conversations on every tick is ~100 GHL
 * API calls per tick instead of ~50. At 1-min cron frequency that's still
 * comfortably under GHL's OAuth rate limit.
 */
export async function searchCallMessages(
  opts: SearchCallMessagesOpts = {}
): Promise<GHLCallMessage[]> {
  const locationId = requireGHLLocationId();
  const limit = Math.min(opts.limit ?? 100, 100);

  const convQuery: Query = {
    locationId,
    limit,
    sort: "desc",
    sortBy: "last_message_date",
  };
  // NOTE: GHL's `startAfterDate` on this endpoint is a *pagination cursor*
  // (search_after on last_message_date), not a date filter. We poll the
  // newest `limit` conversations every tick and rely on the
  // call_recording_imports.ghl_message_id UNIQUE constraint to dedupe.

  const convRes = await ghlFetch<{
    conversations?: Array<{ id: string; contactId?: string; locationId?: string }>;
  }>("/conversations/search", { method: "GET" }, convQuery);
  const conversations = convRes.conversations ?? [];

  const out: GHLCallMessage[] = [];
  for (const conv of conversations) {
    const msgRes = await ghlFetch<{
      messages?: { messages?: GHLCallMessage[] };
    }>(
      `/conversations/${conv.id}/messages`,
      { method: "GET" },
      { limit: 20 },
    );
    // GHL nests this oddly: { messages: { lastMessageId, nextPage, messages: [...] } }
    const messages = msgRes.messages?.messages ?? [];
    for (const m of messages) {
      const isCall =
        m.type === "TYPE_CALL" ||
        m.type === 3 ||
        m.type === "3" ||
        !!m.meta?.call;
      if (!isCall) continue;
      // Annotate conversationId + contactId from the parent in case the
      // message payload omits them (observed on some accounts).
      out.push({
        ...m,
        conversationId: m.conversationId ?? conv.id,
        contactId: m.contactId ?? conv.contactId,
        locationId: m.locationId ?? conv.locationId ?? locationId,
      });
    }
  }

  // De-dupe in case a message id appears in multiple conversations (shouldn't
  // happen but be safe — Set on id).
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/**
 * Find the most recent call message for a single contact. Used by the
 * disposition webhook handler when GHL's Custom Webhook payload doesn't
 * include the disposition name (the "Custom Disposition" merge tag is not
 * always available in the picker, and `triggerData` arrives empty in some
 * GHL versions).
 *
 * Returns the raw message JSON so the caller can inspect arbitrary fields
 * (the disposition lives in different paths on different GHL accounts).
 */
export async function findMostRecentCallForContact(
  contactId: string
): Promise<Record<string, unknown> | null> {
  const locationId = requireGHLLocationId();
  const convRes = await ghlFetch<{
    conversations?: Array<{ id: string }>;
  }>(
    "/conversations/search",
    { method: "GET" },
    {
      locationId,
      contactId,
      limit: 5,
      sort: "desc",
      sortBy: "last_message_date",
    }
  );
  const conversations = convRes.conversations ?? [];
  let newest: Record<string, unknown> | null = null;
  let newestTime = 0;
  for (const conv of conversations) {
    const msgRes = await ghlFetch<{
      messages?: { messages?: Array<Record<string, unknown>> };
    }>(
      `/conversations/${conv.id}/messages`,
      { method: "GET" },
      { limit: 25 }
    );
    const messages = msgRes.messages?.messages ?? [];
    for (const m of messages) {
      const type = m.type;
      const meta = (m.meta as { call?: unknown } | undefined) ?? undefined;
      const isCall =
        type === "TYPE_CALL" ||
        type === 3 ||
        type === "3" ||
        type === 1 ||
        type === "1" ||
        !!meta?.call;
      if (!isCall) continue;
      const dateRaw = (m.dateAdded ?? m.dateUpdated) as string | undefined;
      const t = dateRaw ? new Date(dateRaw).getTime() : 0;
      if (t > newestTime) {
        newestTime = t;
        newest = m;
      }
    }
  }
  return newest;
}

/**
 * Download a call recording. Returns the raw audio bytes (Buffer) along
 * with a best-effort content-type for the multipart hint downstream.
 *
 * Endpoint returns the binary directly, not a signed URL. The Authorization
 * header is required.
 */
export async function downloadRecording(
  messageId: string
): Promise<{ audio: Buffer; contentType: string }> {
  const locationId = requireGHLLocationId();
  const token = await resolveDefaultToken();

  const url =
    `${GHL_BASE}/conversations/messages/${messageId}` +
    `/locations/${locationId}/recording`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_API_VERSION,
      Accept: "audio/*",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `GHL GET recording ${messageId} failed: ${res.status} ${body.slice(0, 300)}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const contentType = res.headers.get("content-type") ?? "audio/mpeg";
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, contentType };
}
