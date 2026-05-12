export const MANYCHAT_BASE =
  process.env.MANYCHAT_BASE || "https://api.manychat.com/fb";

if (!process.env.MANYCHAT_TOKEN) {
  throw new Error("MANYCHAT_TOKEN is not set");
}

export const MANYCHAT_TOKEN = process.env.MANYCHAT_TOKEN;

// Tag + field constants live in id-maps.ts so the bridge implementation
// and server callers can share them without dragging in the
// MANYCHAT_TOKEN runtime check above. Re-export here for backward compat
// with any server caller already importing from this file.
export {
  TAG_IDS,
  STATUS_TAG_IDS,
  TERMINAL_TAGS,
  FIELD_IDS,
  ALL_TAG_NAMES,
  type TagName,
  type FieldName,
} from "./id-maps";

// v2 pipeline stage + flag constants live in ./stages.ts so client
// components can import them without dragging in the MANYCHAT_TOKEN
// runtime check above. Re-export here for any server-side caller that
// already imports from this file.
export {
  V2_PIPELINE_STAGES,
  V2_FLAG_TAG_IDS,
  V2_FLAG_NAMES,
  type V2PipelineStage,
  type V2FlagName,
} from "./stages";
