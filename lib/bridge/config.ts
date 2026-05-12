// Server-only bridge config. Mirrors lib/manychat/config.ts but for the
// whatsapp-bridge-node tenant. Client components MUST NOT import this file —
// it throws on missing env. Use lib/manychat/stages.ts for client-safe enums.

export const BRIDGE_BASE =
  process.env.BRIDGE_BASE || "https://wa-bridge-yehuda.fly.dev";

function readToken(): string | null {
  return process.env.BRIDGE_TENANT_TOKEN || null;
}

export function requireBridgeToken(): string {
  const t = readToken();
  if (!t) throw new Error("BRIDGE_TENANT_TOKEN is not set");
  return t;
}

export const BRIDGE_WEBHOOK_SECRET = process.env.BRIDGE_WEBHOOK_SECRET || "";

// Tag + field "ids" are kept as numeric for backward compatibility with
// callers that still pass numeric ids (e.g. pushToManychat). Bridge stores
// tags by NAME, so we round-trip via these maps.
export {
  TAG_IDS,
  STATUS_TAG_IDS,
  TERMINAL_TAGS,
  FIELD_IDS,
  type TagName,
  type FieldName,
  ALL_TAG_NAMES,
} from "../manychat/id-maps";

export {
  V2_PIPELINE_STAGES,
  V2_FLAG_TAG_IDS,
  V2_FLAG_NAMES,
  type V2PipelineStage,
  type V2FlagName,
} from "../manychat/stages";
