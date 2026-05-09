import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";

export const botRuns = pgTable("bot_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  leadsSeen: integer("leads_seen").default(0),
  decisions: integer("decisions").default(0),
  repliesSent: integer("replies_sent").default(0),
  escalations: integer("escalations").default(0),
  errors: integer("errors").default(0),
  status: text("status"),
});

export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => botRuns.id),
  manychatSubId: text("manychat_sub_id").notNull(),
  leadName: text("lead_name"),
  inputMessages: jsonb("input_messages"),
  ruleMatched: text("rule_matched"),
  aiUsed: boolean("ai_used"),
  aiConfidence: numeric("ai_confidence"),
  classifiedTag: text("classified_tag"),
  prevTag: text("prev_tag"),
  actionTaken: text("action_taken"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const repliesSent = pgTable("replies_sent", {
  id: serial("id").primaryKey(),
  decisionId: integer("decision_id").references(() => decisions.id),
  manychatSubId: text("manychat_sub_id").notNull(),
  templateUsed: text("template_used"),
  text: text("text").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  manychatMsgId: text("manychat_msg_id"),
});

export const escalations = pgTable("escalations", {
  id: serial("id").primaryKey(),
  decisionId: integer("decision_id").references(() => decisions.id),
  manychatSubId: text("manychat_sub_id").notNull(),
  leadName: text("lead_name"),
  reason: text("reason").notNull(),
  triggerText: text("trigger_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  analyzeRequested: boolean("analyze_requested").default(false).notNull(),
  analysisSummary: text("analysis_summary"),
  suggestedReply: text("suggested_reply"),
  suggestedReplies: jsonb("suggested_replies").$type<
    { label: string; text: string; reasoning: string }[]
  >(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  chosenOptionIndex: integer("chosen_option_index"),
  suggestedTag: text("suggested_tag"),
  suggestedTagReason: text("suggested_tag_reason"),
  tagAppliedAt: timestamp("tag_applied_at", { withTimezone: true }),
});

export const anomalies = pgTable("anomalies", {
  id: serial("id").primaryKey(),
  manychatSubId: text("manychat_sub_id").notNull(),
  type: text("type"),
  description: text("description"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const botConfig = pgTable("bot_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  manychatSubId: text("manychat_sub_id").primaryKey(),
  name: text("name"),
  active: boolean("active").default(true).notNull(),
  source: text("source").default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
