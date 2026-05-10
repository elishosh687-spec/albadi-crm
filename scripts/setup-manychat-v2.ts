/**
 * One-time setup — creates the v2 custom fields and flag tags in ManyChat
 * if they don't already exist. Idempotent (skips existing).
 *
 * Run:  npx tsx scripts/setup-manychat-v2.ts
 *
 * Outputs IDs which need to be pasted into lib/manychat/config.ts (V2_FIELDS, V2_FLAG_TAGS).
 */
import "dotenv/config";

const MANYCHAT_BASE = process.env.MANYCHAT_BASE || "https://api.manychat.com/fb";
const TOKEN = process.env.MANYCHAT_TOKEN;
if (!TOKEN) {
  console.error("MANYCHAT_TOKEN not set in .env");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

interface ExistingTag { id: number; name: string; }
interface ExistingField { id: number; name: string; type: string; description?: string; }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MANYCHAT_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { status: string; data?: T };
  if (json.status !== "success") throw new Error(`GET ${path} returned ${JSON.stringify(json)}`);
  return json.data as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${MANYCHAT_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  const json = JSON.parse(text) as { status: string; data?: T; message?: string };
  if (json.status !== "success") throw new Error(`POST ${path} returned ${text}`);
  return json.data as T;
}

const NEW_FIELDS: { caption: string; type: "text"; description: string }[] = [
  { caption: "next_action", type: "text", description: "Bot-suggested next action (Hebrew sentence)" },
  { caption: "bot_summary", type: "text", description: "One-line context summary written by Claude" },
];

const NEW_TAGS: string[] = ["דחוף", "עסקה_גדולה", "ביקש_שיחה", "אחרי_החג", "מועדף"];

async function main() {
  console.log("Reading existing fields and tags...");
  const existingFields = await getJson<ExistingField[]>("/page/getCustomFields");
  const existingTags = await getJson<ExistingTag[]>("/page/getTags");

  const fieldIdsByName = new Map<string, number>();
  for (const f of existingFields) fieldIdsByName.set(f.name, f.id);
  const tagIdsByName = new Map<string, number>();
  for (const t of existingTags) tagIdsByName.set(t.name, t.id);

  // === Custom fields ===
  console.log("\n=== Custom Fields ===");
  for (const spec of NEW_FIELDS) {
    if (fieldIdsByName.has(spec.caption)) {
      console.log(`  exists  ${fieldIdsByName.get(spec.caption)}  ${spec.caption}`);
      continue;
    }
    const data = await postJson<ExistingField>("/page/createCustomField", {
      caption: spec.caption,
      type: spec.type,
      description: spec.description,
    });
    fieldIdsByName.set(spec.caption, data.id);
    console.log(`  created ${data.id}  ${spec.caption}`);
  }

  // === Tags ===
  console.log("\n=== Flag Tags ===");
  for (const name of NEW_TAGS) {
    if (tagIdsByName.has(name)) {
      console.log(`  exists  ${tagIdsByName.get(name)}  ${name}`);
      continue;
    }
    const data = await postJson<ExistingTag>("/page/createTag", { name });
    tagIdsByName.set(name, data.id);
    console.log(`  created ${data.id}  ${name}`);
  }

  // === Output config snippet ===
  console.log("\n=== Paste into lib/manychat/config.ts ===\n");
  console.log("export const V2_FIELD_IDS = {");
  console.log(`  pipeline_stage: ${fieldIdsByName.get("pipeline_stage") ?? "MISSING"},`);
  console.log(`  next_action:    ${fieldIdsByName.get("next_action") ?? "MISSING"},`);
  console.log(`  bot_summary:    ${fieldIdsByName.get("bot_summary") ?? "MISSING"},`);
  console.log("} as const;\n");
  console.log("export const V2_FLAG_TAG_IDS = {");
  for (const name of NEW_TAGS) {
    console.log(`  "${name}": ${tagIdsByName.get(name) ?? "MISSING"},`);
  }
  console.log("} as const;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
