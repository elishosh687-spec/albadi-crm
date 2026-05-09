"use server";

function baseUrl(): string {
  // Prefer canonical production URL — VERCEL_URL points to a deploy-specific
  // host that's gated by Vercel Authentication and returns HTML for our
  // Bearer-token API calls.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  return "http://localhost:3000";
}

function authHeader(): HeadersInit {
  const secret = process.env.BOT_SECRET;
  if (!secret) throw new Error("BOT_SECRET not configured");
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

export async function requestAnalysis(escalationId: number) {
  try {
    const res = await fetch(`${baseUrl()}/api/bot/analyze-escalation`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ id: escalationId }),
      cache: "no-store",
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function requestAllAnalyses() {
  try {
    const res = await fetch(`${baseUrl()}/api/bot/analyze-all-escalations`, {
      method: "POST",
      headers: authHeader(),
      cache: "no-store",
    });
    const json = (await res.json()) as { ok?: boolean; marked?: number; error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "failed" };
    return { ok: true, marked: json.marked ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
