"use server";

function baseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function authHeader(): HeadersInit {
  const secret = process.env.BOT_SECRET;
  if (!secret) throw new Error("BOT_SECRET not configured");
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

export interface RunBotResult {
  ok: boolean;
  error?: string;
  runId?: number;
  leadsSeen?: number;
  decisions?: number;
  escalations?: number;
  errors?: number;
}

export async function runBotNow(): Promise<RunBotResult> {
  try {
    const res = await fetch(`${baseUrl()}/api/bot/cron`, {
      method: "POST",
      headers: authHeader(),
      cache: "no-store",
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (json.error as string) ?? "failed" };
    }
    return {
      ok: true,
      runId: json.runId as number,
      leadsSeen: json.leadsSeen as number,
      decisions: json.decisions as number,
      escalations: json.escalations as number,
      errors: json.errors as number,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export interface SimpleResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function triggerRestartSend(): Promise<SimpleResult> {
  try {
    // Fire-and-forget: route is maxDuration=120, runs in a separate Lambda invocation.
    fetch(`${baseUrl()}/api/bot/restart-send`, {
      method: "POST",
      headers: authHeader(),
      cache: "no-store",
    }).catch((e) => console.error("[restart-send dispatch]", e));
    // Brief delay to ensure the request leaves before the Server Action returns.
    await new Promise((r) => setTimeout(r, 200));
    return {
      ok: true,
      message: "השליחה רצה ברקע — בדוק את היסטוריית הריצות בעוד 2–3 דקות",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "dispatch failed" };
  }
}

export async function addLead(formData: FormData): Promise<SimpleResult> {
  const subscriberId = String(formData.get("subscriber_id") ?? "").trim();
  const nameRaw = String(formData.get("name") ?? "").trim();
  const name = nameRaw.length > 0 ? nameRaw : null;

  if (!subscriberId) return { ok: false, error: "חסר subscriber_id" };

  try {
    const res = await fetch(`${baseUrl()}/api/bot/new-lead`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ subscriber_id: subscriberId, name }),
      cache: "no-store",
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "failed" };
    return { ok: true, message: `נוסף: ${name ?? subscriberId}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
