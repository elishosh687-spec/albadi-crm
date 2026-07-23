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
  uniqueIndex,
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
  // GHL-mirrored — Eli edits in GHL UI, resync webhook pulls back to DB.
  email: text("email"),

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

  // === 8-stage pipeline refactor (see lib/manychat/stages.ts) ===
  // When the customer last replied (≠ lastFollowUpAt which is when WE last touched).
  lastResponseAt: timestamp("last_response_at", { withTimezone: true }),
  // Required when pipeline_stage = LOST. Enum-by-convention; values defined
  // in lib/manychat/stages.ts → LOSS_REASONS.
  lossReason: text("loss_reason"),
  // Lead priority for sorting/filtering — low|normal|high|urgent.
  priority: text("priority"),
  // Denormalized from crm_lead_episodes.ownerId for fast filtering.
  ownerId: text("owner_id"),

  // Manual factory-quote spec that Eli filled but hasn't sent yet.
  // Shape: FactoryProductSpec + optional notes. Cleared on successful
  // POST /api/factory/quote-request. See lib/factory/types.ts.
  factorySpecDraft: jsonb("factory_spec_draft"),

  // Legacy Kommo CRM id — preserved from earlier CRM. Not actively used by
  // the current code but kept to avoid losing historical mapping.
  kommoLeadId: text("kommo_lead_id"),

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
// callback at /api/integrations/oauth/callback. The access_token is
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
  // QuoteActualCosts — post-close reconciliation: the REAL factory + shipping
  // (+ free-form other) costs that materialized after a WON deal, so Eli can
  // compare planned-vs-actual profit. Column added via direct DDL (drizzle-kit
  // push hangs on orphan configurator_* tables — see CLAUDE.md). Kept SEPARATE
  // from finalPricing so a re-finalize can't wipe it.
  actualCosts: jsonb("actual_costs"),
  // FactoryPricingResult snapshot of the SELF-CALCULATED estimate (מחשבון משוער)
  // captured when a priced draft is promoted to the factory — BEFORE finalize
  // overwrites finalPricing with the factory's real price. Lets the "טיוטה מול
  // הצעת מפעל" comparison show my-estimate vs factory-actual on the SAME quote
  // even after promotion. Added via direct DDL (drizzle-kit push hangs — see
  // CLAUDE.md). Null for quotes that never had a self-estimate.
  draftEstimate: jsonb("draft_estimate"),
  // DealMilestones (lib/factory/types.ts) — the post-WON "תיק עסקה" timeline:
  // mockup → invoice → layout → production → shipping → delivered, each with a
  // date stamp and optional files (Vercel Blob URLs, mirrored to GHL as notes).
  // Added via direct DDL 2026-07-22 (drizzle-kit push hangs — see CLAUDE.md).
  dealMilestones: jsonb("deal_milestones"),
  // Soft-delete tombstone: when set, the quote is in the "סל מיחזור" (recycle
  // bin) — hidden from every default list but restorable (Eli 2026-07-23).
  // Lets a deleted draft come back without the salesperson resubmitting. Added
  // via direct DDL (scripts/_add-deleted-at.ts) — drizzle-kit push hangs (CLAUDE.md).
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // "סגור עסקה" — explicitly pull a finalized quote into the עסקאות tab,
  // decoupled from the lead's WON pipeline stage (most finalized quotes never
  // got marked WON, so they were invisible). Non-null = shown in עסקאות.
  // deal_group_id groups several quotes into ONE combined deal (multi-product,
  // one invoice); a single-quote deal shares its own id. Added via direct DDL
  // 2026-07-23 (drizzle-kit push hangs — see CLAUDE.md).
  closedDealAt: timestamp("closed_deal_at", { withTimezone: true }),
  dealGroupId: text("deal_group_id"),
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
    // GHL Contact Task id — null until first sync via syncTaskToGHL.
    ghlTaskId: text("ghl_task_id"),
  },
  (t) => ({
    sidStatusIdx: index("crm_tasks_sid_status_idx").on(t.manychatSubId, t.status),
  })
);

// Adding cached GHL task id to the existing table — populated by
// integrations/ghl/sync.ts:syncTaskToGHL on first push. drizzle-kit push will
// create the column without losing data.

// Signal-derived GHL Contact Tasks cache. Each row maps a single (lead,
// signal_kind) pair to the GHL task id we created for it. Lets the
// reconciler diff desired-vs-existing and avoid duplicates. signal_kind
// is one of the keys defined in lib/ghl-tasks/derive.ts (e.g.
// 'needs_eli_escalation', 'draft_pending', 'factory_received', etc.).
export const ghlLeadTasks = pgTable(
  "ghl_lead_tasks",
  {
    id: serial("id").primaryKey(),
    leadSid: text("lead_sid").notNull(),
    signalKind: text("signal_kind").notNull(),
    ghlTaskId: text("ghl_task_id").notNull(),
    title: text("title"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completed: boolean("completed").default(false).notNull(),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqLeadSignal: uniqueIndex("ghl_lead_tasks_uniq_idx").on(t.leadSid, t.signalKind),
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

    // Inbound channel that triggered this decision. 'bridge' | 'green' | 'ghl'
    source: text("source").default("bridge"),
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

// === GHL call recording → Whisper → GPT → contact note pipeline ===
//
// One row per recording (keyed on ghl_message_id). State machine progresses
// pending → transcribing → analyzing → posted (or failed / skipped_oversize).
// Each cron tick advances rows independently per-stage, so partial failures
// don't block other rows.
//
// See [CLAUDE.md §"GHL call recording analysis pipeline"] for the full doc.
export const callRecordingImports = pgTable(
  "call_recording_imports",
  {
    id: serial("id").primaryKey(),
    // GHL message id for the call. Unique → idempotent re-ingest from cron.
    ghlMessageId: text("ghl_message_id").notNull().unique(),
    ghlContactId: text("ghl_contact_id").notNull(),
    ghlConversationId: text("ghl_conversation_id").notNull(),

    // Optional metadata from stage-1 enrichment.
    recordingUrl: text("recording_url"),
    callDurationSec: integer("call_duration_sec"),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),

    // Set by stage 2.
    transcript: text("transcript"),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),

    // Set by stage 3 — structured analysis output. Shape lives in
    // lib/autoresponder/call-analysis.ts → CallAnalysis interface.
    analysis: jsonb("analysis"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),

    // Set by stage 4. Idempotent: stage 4 checks existing GHL notes for the
    // `[CALL-ANALYSIS v1] msg=<id>` marker before posting.
    postedBackAt: timestamp("posted_back_at", { withTimezone: true }),
    postedNoteId: text("posted_note_id"),

    // GHL Contact Task id for the auto-created "callback" task — set by stage 4
    // when analysis.callback_at is present. Null if no callback was agreed, or
    // before stage 4 ran. Persisted so re-entry is a cheap NULL check (no API).
    callbackTaskId: text("callback_task_id"),

    // State + retry tracking. Lets the cron query "what's stuck" cheaply.
    status: text("status").notNull().default("pending"),
    // 'pending' | 'transcribing' | 'analyzing' | 'posted'
    // | 'failed' | 'skipped_oversize' | 'skipped_voicemail'
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Cron queries "what's pending in each stage" → status + attempts cap.
    statusAttemptsIdx: index("call_recording_imports_status_attempts_idx").on(
      t.status,
      t.attempts
    ),
  })
);

// ElevenLabs Conversational AI call → GHL bridge. Additive sibling of
// call_recording_imports (which handles GHL-native dialer recordings). One row
// per ElevenLabs conversation, keyed on conversation_id UNIQUE for idempotent
// re-ingest from the sync cron. State machine in `status`:
//   'pending' → 'enriched' (transcript+meta pulled) → 'analyzed' → 'posted'
//   branch terminals: 'failed' (>= MAX_ATTEMPTS), 'skipped_no_contact'
//   (web/widget call with no phone to bind a GHL contact), 'skipped_empty'
//   (no transcript / zero-length call).
// See app/api/elevenlabs/sync-calls/route.ts for the staged pipeline.
export const elevenlabsCallImports = pgTable(
  "elevenlabs_call_imports",
  {
    id: serial("id").primaryKey(),
    // ElevenLabs conversation id (e.g. "conv_7601kt…"). Unique → dedupe.
    conversationId: text("conversation_id").notNull().unique(),
    agentId: text("agent_id"),

    // Telephony metadata (null for web/widget calls).
    phone: text("phone"),
    direction: text("direction"), // 'inbound' | 'outbound' | null
    callDurationSec: integer("call_duration_sec"),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),

    // Resolved in the post stage by phone lookup. Null until then.
    ghlContactId: text("ghl_contact_id"),

    // Set by stage 2 (enrich): transcript text built from ElevenLabs turns,
    // plus ElevenLabs' own summary (fallback for the note when the OpenAI
    // analysis is null — short calls / LLM hiccup).
    transcript: text("transcript"),
    elevenSummary: text("eleven_summary"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    // Set by stage 3 — CallAnalysis shape (lib/autoresponder/call-analysis.ts).
    analysis: jsonb("analysis"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),

    // Set by stage 4. GHL-hosted media url for the uploaded recording, plus
    // the note + attachment message ids. Idempotent: stage 4 checks existing
    // notes for the `[CALL-ANALYSIS-11L v1] conv=<id>` marker before posting.
    recordingGhlUrl: text("recording_ghl_url"),
    postedNoteId: text("posted_note_id"),
    attachedMessageId: text("attached_message_id"),
    postedBackAt: timestamp("posted_back_at", { withTimezone: true }),

    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    statusAttemptsIdx: index("elevenlabs_call_imports_status_attempts_idx").on(
      t.status,
      t.attempts
    ),
  })
);

// Per-lead deep sales analysis ("why is this lead stuck"). One row per analysis
// run, keyed by lead. The latest row per sid is the current verdict (read with
// ORDER BY created_at DESC LIMIT 1). `input_hash` is a hash of the dossier
// (calls + messages + quotes + stage) — if unchanged since the last run we skip
// the LLM and reuse the stored verdict (cheap re-clicks of the "נתח" button).
// `verdict` holds the structured LeadAnalysis (see lib/analysis/analyze-lead.ts).
// Surfaced as a GHL contact note (marker `[LEAD-ANALYSIS v1] sid=<sid>`) and in
// the widget/v3 analysis panels. The aggregate "why aren't leads closing" report
// is a deterministic rollup over these rows — no second LLM pass, so it can't
// cherry-pick.
export const leadAnalyses = pgTable(
  "lead_analyses",
  {
    id: serial("id").primaryKey(),
    manychatSubId: text("manychat_sub_id").notNull(),
    // Structured LeadAnalysis verdict (root_cause, primary_blocker, objections
    // with grounded quotes, price_forensics, commitment_scorecard, etc.).
    verdict: jsonb("verdict").notNull(),
    // Hash of the dossier inputs → cache key for skip-if-unchanged.
    inputHash: text("input_hash").notNull(),
    model: text("model"),
    version: text("version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    subCreatedIdx: index("lead_analyses_sub_created_idx").on(
      t.manychatSubId,
      t.createdAt
    ),
  })
);

// Competitor price/lead-time intelligence log ("מחיר מתחרים" hub tab).
// One row = one head-to-head data point: OUR quote (price + lead time) vs ONE
// competitor's, for a given product spec. Eli logs these manually each time a
// competing quote surfaces so he knows exactly where Albadi stands — on price
// AND on delivery time (a customer may pay more for a faster lead time, so both
// matter). Grouped by `product` in the UI. Optional `leadSid` ties a data point
// to a specific CRM lead. DB is the single source of truth; no external sync.
// Created via raw DDL (scripts/_create-competitor-prices.ts), NOT drizzle-kit
// push (push hangs on the orphan configurator_* rename prompt — see CLAUDE.md).
export const competitorPrices = pgTable(
  "competitor_prices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Free-text product/spec title, e.g. "תיק אל-בד שחור". Rows sharing the same
    // product string group together in the "where I stand".
    product: text("product").notNull(),
    quantity: integer("quantity"),
    // Structured spec — the SAME features we price by, so the comparison is
    // apples-to-apples (shared across our offer and the competitor's). All
    // optional. size is free text ("31×37×17"); handles/lamination are short
    // labels; logoColors drives the plate-fee math (fee × colors).
    size: text("size"),
    handles: text("handles"),
    logoColors: integer("logo_colors"),
    lamination: text("lamination"),
    // Our side of the comparison (NIS + business days). Nullable so Eli can log a
    // competitor sighting before pinning our own number. ourPlateFee = one-time
    // ₪ per colour (part of the real cost even though non-recurring).
    ourPrice: doublePrecision("our_price"),
    ourLeadDays: integer("our_lead_days"),
    ourPlateFee: doublePrecision("our_plate_fee"),
    // The competitor.
    competitor: text("competitor").notNull(),
    competitorPrice: doublePrecision("competitor_price"),
    competitorLeadDays: integer("competitor_lead_days"),
    competitorPlateFee: doublePrecision("competitor_plate_fee"),
    // Optional link to a CRM lead this data point came from.
    leadSid: text("lead_sid"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    productCreatedIdx: index("competitor_prices_product_created_idx").on(
      t.product,
      t.createdAt
    ),
  })
);
