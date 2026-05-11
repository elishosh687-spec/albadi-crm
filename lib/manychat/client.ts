import { MANYCHAT_BASE, MANYCHAT_TOKEN, FIELD_IDS, FieldName } from "./config";
import { db } from "../db";
import { leads } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const headers = {
  Authorization: `Bearer ${MANYCHAT_TOKEN}`,
  "Content-Type": "application/json",
};

export interface SubscriberInfo {
  id: string;
  name?: string;
  phone?: string;
  tags: { id: number; name?: string }[];
  custom_fields: { id: number; name?: string; value: string | number | null }[];
}

const REQUEST_TIMEOUT_MS = 8000;

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${MANYCHAT_BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`ManyChat ${path} failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { status: string; data?: T; message?: string };
    if (json.status !== "success") {
      throw new Error(`ManyChat ${path} returned: ${json.message || "unknown"}`);
    }
    return json.data as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`ManyChat ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSubscriber(subscriberId: string): Promise<SubscriberInfo> {
  return request<SubscriberInfo>(
    `/subscriber/getInfo?subscriber_id=${subscriberId}`
  );
}

export async function addTag(subscriberId: string, tagId: number) {
  return request("/subscriber/addTag", {
    method: "POST",
    body: JSON.stringify({ subscriber_id: subscriberId, tag_id: tagId }),
  });
}

export async function removeTag(subscriberId: string, tagId: number) {
  return request("/subscriber/removeTag", {
    method: "POST",
    body: JSON.stringify({ subscriber_id: subscriberId, tag_id: tagId }),
  });
}

export async function setCustomFields(
  subscriberId: string,
  fields: { name: FieldName; value: string | number }[]
) {
  return request("/subscriber/setCustomFields", {
    method: "POST",
    body: JSON.stringify({
      subscriber_id: subscriberId,
      fields: fields.map((f) => ({
        field_id: FIELD_IDS[f.name],
        field_value: f.value,
      })),
    }),
  });
}

export function getFieldValue(
  fields: SubscriberInfo["custom_fields"],
  name: FieldName
): string | number | null {
  const id = FIELD_IDS[name];
  return fields.find((f) => f.id === id)?.value ?? null;
}

export async function getActiveSubscriberIds(): Promise<string[]> {
  const rows = await db.select({ id: leads.manychatSubId }).from(leads).where(eq(leads.active, true));
  return rows.map((r) => r.id);
}
