/**
 * One-shot CLI — register a Custom Conversation Provider in GHL.
 *
 * GHL routes outbound messages typed with `conversationProviderId=<id>`
 * through the provider's deliveryUrl. That URL is our webhook receiver
 * (app/api/integrations/outbound) which calls sendBridgeMessage to
 * push the message into WhatsApp (via GreenAPI when USE_GREEN_API=1).
 *
 * Idempotent: if a provider with the same name exists in the location,
 * its existing id is returned.
 *
 * Run:
 *   npx tsx integrations/ghl/register-conversation-provider.ts
 *
 * Prereqs:
 *   GHL_API_KEY, GHL_LOCATION_ID, GHL_OUTBOUND_DELIVERY_URL in .env
 *
 * After success: paste GHL_CONVERSATION_PROVIDER_ID into .env + Vercel.
 */
import "dotenv/config";
import { upsertConversationProvider } from "./client";
import { getValidAccessToken } from "./oauth";
import { requireGHLLocationId } from "./config";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

async function main(): Promise<void> {
  const deliveryUrl =
    readEnv("GHL_OUTBOUND_DELIVERY_URL") ||
    "https://albadi-crm.vercel.app/api/integrations/outbound";
  const name = readEnv("GHL_CONVERSATION_PROVIDER_NAME") || "Albadi WhatsApp";

  console.log(`[register] name="${name}" delivery=${deliveryUrl}`);

  const locationId = requireGHLLocationId();
  const accessToken = await getValidAccessToken(locationId);
  if (!accessToken) {
    throw new Error(
      `No OAuth access token for location ${locationId}. Install the Marketplace app first: visit /api/integrations/install`
    );
  }

  const provider = await upsertConversationProvider({
    name,
    deliveryUrl,
    type: "Custom",
    accessToken,
  });

  console.log("\n=== provider ready ===");
  console.log(JSON.stringify(provider, null, 2));
  console.log("\nAdd to .env + Vercel:");
  console.log(`GHL_CONVERSATION_PROVIDER_ID=${provider.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[register] fatal", e);
  process.exit(1);
});
