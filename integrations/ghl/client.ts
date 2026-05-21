// Server-only GHL (GoHighLevel) REST V2 client.
// Docs: https://highlevel.stoplight.io/docs/integrations/

import {
  GHL_BASE,
  GHL_API_VERSION,
  requireGHLToken,
  requireGHLLocationId,
} from "./config";

type Query = Record<string, string | number | boolean | undefined>;

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
  const token = init.accessToken ?? requireGHLToken();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Version", GHL_API_VERSION);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url.toString(), { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GHL ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`
    );
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
