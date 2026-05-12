// Server-only bridge config. Mirrors lib/manychat/config.ts but for the
// whatsapp-bridge-node tenant. Client components MUST NOT import this file —
// it throws on missing env. Use lib/manychat/stages.ts for client-safe enums.

// Strip a stray UTF-8 BOM (U+FEFF) — PowerShell pipes to `vercel env add`
// prepend one on Windows, silently breaking auth/HMAC headers.
// `﻿` escape is the unambiguous BOM regardless of source-file encoding.
const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export const BRIDGE_BASE =
  readEnv("BRIDGE_BASE") || "https://wa-bridge-yehuda.fly.dev";

export function requireBridgeToken(): string {
  const t = readEnv("BRIDGE_TENANT_TOKEN");
  if (!t) throw new Error("BRIDGE_TENANT_TOKEN is not set");
  return t;
}

export const BRIDGE_WEBHOOK_SECRET = readEnv("BRIDGE_WEBHOOK_SECRET");

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
