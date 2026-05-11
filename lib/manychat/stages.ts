// Client-safe pipeline stage / flag constants.
// Do NOT import from `./config` here — config.ts evaluates `MANYCHAT_TOKEN`
// at module load and throws on the client. This file is safe to import
// from "use client" components.

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

export const V2_FLAG_TAG_IDS = {
  "דחוף": 87265384,
  "עסקה_גדולה": 87265385,
  "ביקש_שיחה": 87265386,
  "אחרי_החג": 87265387,
  "מועדף": 87265390,
} as const;

export type V2FlagName = keyof typeof V2_FLAG_TAG_IDS;
export const V2_FLAG_NAMES = Object.keys(V2_FLAG_TAG_IDS) as V2FlagName[];
