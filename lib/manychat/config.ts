export const MANYCHAT_BASE =
  process.env.MANYCHAT_BASE || "https://api.manychat.com/fb";

if (!process.env.MANYCHAT_TOKEN) {
  throw new Error("MANYCHAT_TOKEN is not set");
}

export const MANYCHAT_TOKEN = process.env.MANYCHAT_TOKEN;

export const TAG_IDS = {
  ליד_חדש: 84604872,
  מעוניין: 84604876,
  הצעה_בוט: 84644778,
  הצעה_טלפון: 84644793,
  בתהליך: 84622722,
  לקוח: 84604878,
  לא_ענה: 84622721,
  לא_רלוונטי: 84604877,
} as const;

export type TagName = keyof typeof TAG_IDS;
export const ALL_TAG_NAMES = Object.keys(TAG_IDS) as TagName[];

export const FIELD_IDS = {
  notes: 14447147,
  quote_total: 14447148,
  quote_alt: 14447149,
  lead_source: 14447150,
  last_contact_date: 14447151,
  follow_up_date: 14445938,
  lead_score: 14445937,
  quantity: 14356831,
  last_contact_type: 14449102,
  // v2
  pipeline_stage: 14445936,
  next_action: 14571697,
  bot_summary: 14571698,
} as const;

export type FieldName = keyof typeof FIELD_IDS;

// v2 flag tags (boolean labels — multiple per subscriber allowed)
export const V2_FLAG_TAG_IDS = {
  "דחוף": 87265384,
  "עסקה_גדולה": 87265385,
  "ביקש_שיחה": 87265386,
  "אחרי_החג": 87265387,
  "מועדף": 87265390,
} as const;
export type V2FlagName = keyof typeof V2_FLAG_TAG_IDS;
export const V2_FLAG_NAMES = Object.keys(V2_FLAG_TAG_IDS) as V2FlagName[];

// v2 pipeline stage values (single value per lead — enforced by code)
export const V2_PIPELINE_STAGES = [
  "NEW",
  "QUESTIONNAIRE",
  "QUOTED",
  "NEGOTIATING",
  "WAITING_CALL",
  "IN_PROGRESS",
  "WON",
  "SILENT",
  "DROPPED",
] as const;
export type V2PipelineStage = (typeof V2_PIPELINE_STAGES)[number];

export const STATUS_TAG_IDS: number[] = [
  TAG_IDS.ליד_חדש,
  TAG_IDS.מעוניין,
  TAG_IDS.הצעה_בוט,
  TAG_IDS.הצעה_טלפון,
  TAG_IDS.בתהליך,
  TAG_IDS.לקוח,
  TAG_IDS.לא_ענה,
  TAG_IDS.לא_רלוונטי,
];

export const TERMINAL_TAGS: number[] = [TAG_IDS.לקוח, TAG_IDS.לא_רלוונטי];
