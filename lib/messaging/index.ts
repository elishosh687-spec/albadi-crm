/**
 * Messaging adapter — single import surface for the rest of the codebase.
 *
 * Flip USE_BRIDGE=1 in env to route ManyChat-shaped calls through the
 * whatsapp-bridge-node tenant + DB-owned tag/field state. USE_BRIDGE=0
 * (default) keeps the existing ManyChat HTTP path live and unchanged so
 * we can revert instantly.
 *
 * Public surface mirrors lib/manychat/client.ts:
 *   getSubscriber, addTag, removeTag, setCustomFields, getFieldValue,
 *   getActiveSubscriberIds.
 *
 * Plus bridge-only extras (no-op or throw under ManyChat backend):
 *   sendMessage, resolveJidFromPhone.
 */
import type { FieldName } from "../manychat/id-maps";

const useBridge = process.env.USE_BRIDGE === "1";

// We import both impls lazily-as-modules so unused side effects (the
// MANYCHAT_TOKEN throw in manychat/config) only fire on the active path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = useBridge
  ? require("../bridge/client")
  : require("../manychat/client");

export type SubscriberInfo = {
  id: string;
  name?: string;
  phone?: string;
  tags: { id: number; name?: string }[];
  custom_fields: { id: number; name?: string; value: string | number | null }[];
};

export function getSubscriber(subscriberId: string): Promise<SubscriberInfo> {
  return impl.getSubscriber(subscriberId);
}

export function addTag(subscriberId: string, tagId: number): Promise<unknown> {
  return impl.addTag(subscriberId, tagId);
}

export function removeTag(subscriberId: string, tagId: number): Promise<unknown> {
  return impl.removeTag(subscriberId, tagId);
}

export function setCustomFields(
  subscriberId: string,
  fields: { name: FieldName; value: string | number }[]
): Promise<unknown> {
  return impl.setCustomFields(subscriberId, fields);
}

export function getFieldValue(
  fields: SubscriberInfo["custom_fields"],
  name: FieldName
): string | number | null {
  return impl.getFieldValue(fields, name);
}

export function getActiveSubscriberIds(): Promise<string[]> {
  return impl.getActiveSubscriberIds();
}

// Bridge-only helpers — return informative error under ManyChat backend.

export async function sendMessage(
  recipient: string,
  message: string,
  mediaPath?: string
): Promise<{ wa_message_id: string }> {
  if (!useBridge) {
    throw new Error(
      "sendMessage is bridge-only. Set USE_BRIDGE=1 or call ManyChat sendFlow directly."
    );
  }
  return impl.sendBridgeMessage(recipient, message, mediaPath);
}

export async function resolveJidFromPhone(phone: string): Promise<string | null> {
  if (!useBridge) return null;
  return impl.resolveJidFromPhone(phone);
}

export function isBridgeActive(): boolean {
  return useBridge;
}
