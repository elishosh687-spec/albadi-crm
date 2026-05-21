import {
  pgTable,
  serial,
  bigserial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  doublePrecision,
} from "drizzle-orm/pg-core";
/* eslint-disable @typescript-eslint/no-unused-vars */
// `integer` kept in import list for forward compat; unused right now.

export const leads = pgTable("leads", {
  manychatSubId: text("manychat_sub_id").primaryKey(),
  name: text("name"),
  active: boolean("active").default(true).notNull(),
  source: text("source").default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),

  // === bridge migration: DB-owned identity + tags + custom fields ===
  // Populated when USE_BRIDGE=1; left null for legacy ManyChat-only rows
  // until the backfill script runs.
  waJid: text("wa_jid"),
  phoneE164: text("phone_e164"),

  // Pipeline state (mirror of v2 ManyChat custom fields, but DB is the
  // source of truth once USE_BRIDGE=1).
  pipelineStage: text("pipeline_stage"),
  nextAction: text("next_action"),
  botSummary: text("bot_summary"),
  notes: text("notes"),

  // Free-form fields previously stored in ManyChat custom_fields.
  quoteTotal: text("quote_total"),
  quoteAlt: text("quote_alt"),
  leadSource: text("lead_source"),
  lastContactDate: text("last_contact_date"),
  followUpDate: text("follow_up_date"),
  leadScore: text("lead_score"),
  quantity: text("quantity"),
  lastContactType: text("last_contact_type"),

  // Auto-responder questionnaire state. Null = no active questionnaire.
  // Shape: { step: 1..9, shipping?, quantity?, product?, handles?, colors?, quoteResult?, doneAt? }
  qState: jsonb("q_state"),

  // === follow-up engine (spec: docs/FOLLOWUP-SPEC.md) ===
  followUpCount: integer("follow_up_count").default(0).notNull(),
  lastFollowUpAt: timestamp("last_follow_up_at", { withTimezone: true }),
  botPaused: boolean("bot_paused").default(false).notNull(),
  // Currently single-flag scalar (e.g. 'NEEDS_ELI'). Migrate to array later if needed.
  pipelineFlag: text("pipeline_flag"),

  // Manual factory-quote spec that Eli filled but hasn't sent yet.
  // Shape: FactoryProductSpec + optional notes. Cleared on successful
  // POST /api/factory/quote-request. See lib/factory/types.ts.
  factorySpecDraft: jsonb("factory_spec_draft"),

  // GoHighLevel CRM ids. Populated by integrations/ghl/sync.ts on first sync.
  ghlContactId: text("ghl_contact_id"),
  ghlOpportunityId: text("ghl_opportunity_id"),
  // Set by integrations/ghl/backfill.ts after it writes the full set of
  // archival notes (chat history + decisions + activity + order summary).
  // Gates --resume so we don't duplicate notes on re-runs.
  ghlBackfilledAt: timestamp("ghl_backfilled_at", { withTimezone: true }),
  // Set by backfill --chat-to-inbox after every message has been replayed
  // through GHL Conversations API. Gates re-runs of that mode.
  ghlChatImportedAt: timestamp("ghl_chat_imported_at", { withTimezone: true }),
});

// DB-owned tags (replaces ManyChat tag IDs). One row per (lead, tag).
// Tag names are the keys of TAG_IDS / V2_FLAG_TAG_IDS, not numeric IDs.
export const leadTags = pgTable("lead_tags", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  tag: text("tag").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
});

// Bridge webhook event log — every signed event we receive lands here.
// Acts as both audit + idempotency dedupe (unique evt_id) + catch-up cursor.
export const bridgeEvents = pgTable("bridge_events", {
  id: serial("id").primaryKey(),
  evtId: text("evt_id").notNull().unique(),
  type: text("type").notNull(),
  tenant: text("tenant"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb("payload"),
});

// === v2 (Claude-only classification) ===

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  direction: text("direction").notNull(),
  text: text("text"),
  payload: jsonb("payload"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),

  // bridge-side message id (e.g. "3A1B…"), null for ManyChat-origin rows.
  waMessageId: text("wa_message_id"),

  // Origin of the message. 'lead' = inbound from customer.
  // For direction='out': 'bot' = autoresponder/cron, 'eli' = manual reply
  // (dashboard sendManualReply or WA Business app — distinguished by the
  // bridge webhook sender-attribution heuristic in app/api/bridge/webhook).
  // Nullable: legacy rows pre-migration are NULL.
  sender: text("sender"),
});

// GHL OAuth tokens — one row per (location, app). Populated by the OAuth
// callback at /api/integrations/ghl/oauth/callback. The access_token is
// what we use for scopes that the Private Integration Token can't access
// (specifically conversations/providers.write — needed to register a
// Custom Conversation Provider for Phase 1F outbound chat).
export const ghlOauthTokens = pgTable("ghl_oauth_tokens", {
  locationId: text("location_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: text("scope"),
  companyId: text("company_id"),
  userType: text("user_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Key/value config table. Pre-existed from the v1 schema; re-declared here
// so the Settings UI can read/write entries (bot prompts, feature toggles).
export const botConfig = pgTable("bot_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Bot-generated draft replies awaiting Eli's approval. Created when a money
// moment is detected (stage gate or LLM is_money_moment flag) so Eli can
// review/edit/approve before the message goes out to the customer.
export const botDrafts = pgTable("bot_drafts", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  draftText: text("draft_text").notNull(),
  editedText: text("edited_text"),
  // pending | approved | rejected | sent | failed
  status: text("status").notNull().default("pending"),
  // 'stage_gate' | 'discount_request' | 'price_question' | 'negotiation' |
  // 'commitment' | 'manual'
  moneyReason: text("money_reason"),
  llmConfidence: text("llm_confidence"),
  // Stage the lead was at when the draft was generated (snapshot for UI).
  pipelineStageAtGen: text("pipeline_stage_at_gen"),
  // Optional snapshot of the inbound message that triggered the draft.
  triggerMessageId: integer("trigger_message_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentWaMessageId: text("sent_wa_message_id"),
  rejectReason: text("reject_reason"),
});

// Activity log per lead — append-only timeline of significant events:
//   - stage_change   { from, to, actor }
//   - note_added     { excerpt, actor }
//   - note_deleted   { excerpt, actor }
//   - draft_approved { draftId, actor }
//   - draft_rejected { draftId, reason, actor }
//   - manual_reply   { textPreview, actor }
//   - manual_followup_set / cleared
//   - lead_deleted
// Drives the "לוג פעילות" tab in ExpandedLead. Migration is idempotent
// (CREATE TABLE IF NOT EXISTS) — first write creates the table if absent.
export const leadEvents = pgTable("lead_events", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// analysisQueue, pipelineSuggestions, eliDecisions tables were removed
// when the standalone classifier skill was retired. The bot now writes
// pipeline_stage / flags directly to `leads` based on LLM intent on
// each inbound message.

// === Factory quote pipeline (Feishu integration) ===

// k/v table for pricing + shipping + FX config. Keys we use:
//   'factory_pricing' → JSON with { shippingOptions, exchangeRates, defaultProfitMargin }
// Kept separate from bot_config to avoid mixing operational bot settings
// with pricing/business config (different audiences for editing).
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// One row per "send to factory" event. Lifecycle:
//   pending  — row written to Feishu, awaiting factory to fill J..R
//   received — refresh pulled J..R, factory cost known, awaiting Eli's
//              profit-margin pick + finalize
//   finalized — priceFactoryQuote ran, customer PDF generated and saved
export const factoryQuoteRequests = pgTable("factory_quote_requests", {
  id: text("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  quotationNo: text("quotation_no"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // FactoryProductSpec — { description, material, widthCm, heightCm, depthCm,
  // quantity, printing, finishing, picUrl?, notes? }
  productSpec: jsonb("product_spec").notNull(),
  feishuRowIndex: text("feishu_row_index"),
  // pending | received | finalized
  factoryStatus: text("factory_status").notNull().default("pending"),
  // FactoryResponse — { unitCostCny, cartonQty, cartonLengthCm, cartonWidthCm,
  // cartonHeightCm, cartonCbm, weightKg, supplier, notes }
  factoryResponse: jsonb("factory_response"),
  // FactoryPricingResult — full pricing snapshot at finalize time
  finalPricing: jsonb("final_pricing"),
  pdfUrl: text("pdf_url"),
  sentToCustomerAt: timestamp("sent_to_customer_at", { withTimezone: true }),
});

// Append-only audit log of every bot-side quote sent on WhatsApp. Captures
// both the initial quote (after questionnaire completion) and any auto-requote
// triggered by `requoteWithUpdatedSpec` after a mid-conversation spec change.
// The `leads.quoteTotal` / `leads.quoteAlt` columns are overwritten on each
// requote — this table preserves the full timeline so the dashboard can show
// "quote history" and analytics can compute requote rates / price drift.
export const botQuotes = pgTable(
  "bot_quotes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadSid: text("lead_sid").notNull(), // = leads.manychat_sub_id
    source: text("source").notNull(), // 'initial' | 'requote'
    qState: jsonb("q_state").notNull(), // snapshot of qState at send time
    quoteText: text("quote_text").notNull(), // the WhatsApp message body
    quoteTotalIls: doublePrecision("quote_total_ils"), // calc result.totalOrderPriceIls
    quoteAltTotalIls: doublePrecision("quote_alt_total_ils"), // alt shipping tier total
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    leadSidSentAtIdx: index("bot_quotes_lead_sid_sent_at_idx").on(
      t.leadSid,
      t.sentAt
    ),
  })
);

// === CRM operating layer (additive v1) ===

export const crmContacts = pgTable("crm_contacts", {
  id: serial("id").primaryKey(),
  phoneE164: text("phone_e164").unique(),
  fullName: text("full_name"),
  businessName: text("business_name"),
  email: text("email"),
  locale: text("locale").default("he-IL"),
  timezone: text("timezone").default("Asia/Jerusalem"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const crmLeadEpisodes = pgTable("crm_lead_episodes", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  contactId: integer("contact_id"),
  lifecycleStage: text("lifecycle_stage").notNull().default("NEW_INQUIRY"),
  operationalStatus: text("operational_status").notNull().default("NEW"),
  ownerId: text("owner_id"),
  queueId: text("queue_id"),
  priorityBand: text("priority_band").notNull().default("LOW"),
  scoreTotal: integer("score_total").notNull().default(0),
  firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const crmTasks = pgTable(
  "crm_tasks",
  {
    id: serial("id").primaryKey(),
    manychatSubId: text("manychat_sub_id").notNull(),
    taskType: text("task_type").notNull().default("follow_up"),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    assignedTo: text("assigned_to"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sidStatusIdx: index("crm_tasks_sid_status_idx").on(t.manychatSubId, t.status),
  })
);

export const crmSlaTimers = pgTable(
  "crm_sla_timers",
  {
    id: serial("id").primaryKey(),
    manychatSubId: text("manychat_sub_id").notNull(),
    slaType: text("sla_type").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    breachedAt: timestamp("breached_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sidDueIdx: index("crm_sla_timers_sid_due_idx").on(t.manychatSubId, t.dueAt),
  })
);

export const leadScoreSnapshots = pgTable(
  "lead_score_snapshots",
  {
    id: serial("id").primaryKey(),
    manychatSubId: text("manychat_sub_id").notNull(),
    fitScore: integer("fit_score").notNull().default(0),
    intentScore: integer("intent_score").notNull().default(0),
    engagementScore: integer("engagement_score").notNull().default(0),
    frictionPenalty: integer("friction_penalty").notNull().default(0),
    scoreTotal: integer("score_total").notNull(),
    scoreBand: text("score_band").notNull(),
    scoreVersion: text("score_version").notNull().default("v1"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sidCreatedIdx: index("lead_score_snapshots_sid_created_idx").on(
      t.manychatSubId,
      t.createdAt
    ),
  })
);

export const sourceTouches = pgTable(
  "source_touches",
  {
    id: serial("id").primaryKey(),
    manychatSubId: text("manychat_sub_id").notNull(),
    sourcePrimary: text("source_primary").notNull(),
    sourceDetail1: text("source_detail_1"),
    sourceDetail2: text("source_detail_2"),
    recordSource: text("record_source"),
    touchAt: timestamp("touch_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sidTouchIdx: index("source_touches_sid_touch_idx").on(t.manychatSubId, t.touchAt),
  })
);

export const opportunities = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  pipelineStage: text("pipeline_stage").notNull().default("open"),
  valueIls: doublePrecision("value_ils"),
  currency: text("currency").default("ILS"),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const consentRecords = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id"),
  manychatSubId: text("manychat_sub_id"),
  consentType: text("consent_type").notNull(),
  status: text("status").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("text"), // "text" | "cta_url"
  body: text("body").notNull(),
  headerType: text("header_type"), // null | "video" | "image"
  mediaId: text("media_id"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Bot Supervisor Phase 1 — one row per inbound message. Carries:
//   1. What the LLM supervisor recommended (or a Langfuse trace_id pointing to the full LLM trace).
//   2. What the deterministic code actually did.
//   3. What Eli ultimately decided when he interacted (filled in later, nullable).
// Discrimination of who acted is by entry point, never by guessing.
export const botDecisionLog = pgTable(
  "bot_decision_log",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    manychatSubId: text("manychat_sub_id").notNull(),
    messageId: integer("message_id"), // soft link to messages.id
    inboundText: text("inbound_text"),
    stageBefore: text("stage_before"),
    stageAfter: text("stage_after"),

    // Langfuse linkage (full LLM input/output lives there)
    langfuseTraceId: text("langfuse_trace_id"),

    // Supervisor verdict (denormalized cache; canonical lives in Langfuse trace)
    llmIntent: text("llm_intent"),
    llmConfidence: doublePrecision("llm_confidence"),
    llmRecommended: text("llm_recommended"), // approve_code | override_with_text | escalate_to_eli | silence | supervisor_error
    llmReason: text("llm_reason"),
    llmRiskFlags: jsonb("llm_risk_flags"),

    // What actually happened
    decidedBy: text("decided_by").notNull(), // code | llm_override | llm_unmatch | llm_spec | eli | supervisor_error | silent
    action: text("action").notNull(), // reply_sent | sub_state_advanced | escalated | stage_transition | no_op | paused | unpaused_on_inbound | draft_queued
    replyText: text("reply_text"),
    escalationKind: text("escalation_kind"),
    draftId: integer("draft_id"), // soft link to bot_drafts.id
    metadata: jsonb("metadata"),

    // Eli feedback (nullable; filled later)
    eliAction: text("eli_action"), // approved_as_is | edited_draft | rejected_draft | manual_reply | stage_override | unpaused | paused | direct_whatsapp_reply
    // Classification of WHAT Eli corrected. Lets Phase 2 rule-mining ignore
    // pure rewording (content) and only extract rules from routing/policy
    // overrides. NULL when the action is implicitly typed (e.g. approved_as_is).
    eliCorrectionType: text("eli_correction_type"), // routing | policy | content
    // Explicit "the LLM misclassified" signal. When Eli sets this, the LLM's
    // recommended intent was wrong — Phase 2 will train on this directly.
    eliIntentOverride: text("eli_intent_override"),
    eliEditText: text("eli_edit_text"),
    eliRejectReason: text("eli_reject_reason"),
    eliManualReply: text("eli_manual_reply"),
    eliStageFrom: text("eli_stage_from"),
    eliStageTo: text("eli_stage_to"),
    eliDecidedAt: timestamp("eli_decided_at", { withTimezone: true }),
  },
  (t) => ({
    sidCreatedIdx: index("bot_decision_log_sid_created_idx").on(
      t.manychatSubId,
      t.createdAt
    ),
    divergenceIdx: index("bot_decision_log_divergence_idx").on(
      t.llmRecommended,
      t.decidedBy
    ),
    eliActionIdx: index("bot_decision_log_eli_action_idx").on(t.eliAction),
  })
);
