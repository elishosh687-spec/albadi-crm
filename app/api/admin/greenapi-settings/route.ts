/**
 * Read and change GreenAPI instance settings from the server, where the
 * credentials already live.
 *
 * WHY THIS EXISTS: the three GREEN_API_* vars are production-only and
 * encrypted — `vercel env pull` returns empty strings for them. So the only
 * safe way to touch instance settings from a session is to do it server-side.
 * The token never leaves Vercel, never reaches a chat, never reaches git.
 *
 *   GET  → current settings (read-only)
 *   POST { "set": { "outgoingMessageStatusWebhook": "yes" } }
 *
 * ⚠️ ALLOW-LISTED ON PURPOSE. Only the webhook-type flags can be written.
 * `webhookUrl`, `webhookUrlToken`, `delaySendMessagesMilliseconds` and
 * everything else are refused, because an endpoint that can rewrite the
 * webhook url is one typo away from silently severing every inbound message —
 * the exact failure this whole change set exists to detect.
 *
 * ⚠️ setSettings REBOOTS the instance (GreenAPI applies settings on restart,
 * up to ~5 minutes). That is tolerable here only because this instance already
 * restarts several times a day on its own — 118 `starting`→`authorized` cycles
 * in the 14 days to 2026-09-07 — so a deliberate one is within its normal
 * operation rather than a new risk.
 *
 * Auth: Bearer BOT_SECRET or CALL_TRIGGER_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { greenConfigured, greenEndpoint } from "@/lib/greenapi/client";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** The only keys this endpoint may write. Webhook TYPE toggles, nothing else. */
const WRITABLE = new Set([
  "incomingWebhook",
  "outgoingWebhook",
  "outgoingMessageWebhook",
  "outgoingAPIMessageWebhook",
  "outgoingMessageStatusWebhook",
  "stateWebhook",
  "deviceWebhook",
  "incomingCallWebhook",
  "editedMessageWebhook",
  "deletedMessageWebhook",
  "pollMessageWebhook",
  "incomingBlockWebhook",
]);

function authorized(req: NextRequest): boolean {
  const hdr = req.headers.get("authorization") ?? "";
  for (const name of ["BOT_SECRET", "CALL_TRIGGER_SECRET"]) {
    const secret = (process.env[name] ?? "").trim();
    if (secret && hdr === `Bearer ${secret}`) return true;
  }
  return false;
}

async function readSettings(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(greenEndpoint("getSettings"), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Never echo a token back out, whatever GreenAPI decides to include. */
function safeView(s: Record<string, unknown> | null): Record<string, unknown> {
  if (!s) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k.toLowerCase().includes("token")) continue;
    out[k] = v;
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!greenConfigured()) {
    return NextResponse.json({ ok: false, error: "green_not_configured" });
  }
  return NextResponse.json({ ok: true, settings: safeView(await readSettings()) });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!greenConfigured()) {
    return NextResponse.json({ ok: false, error: "green_not_configured" });
  }

  let body: { set?: Record<string, string> };
  try {
    body = (await req.json()) as { set?: Record<string, string> };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const set = body.set ?? {};
  const rejected = Object.keys(set).filter((k) => !WRITABLE.has(k));
  if (rejected.length) {
    return NextResponse.json(
      { ok: false, error: "not_writable", rejected, writable: [...WRITABLE] },
      { status: 400 },
    );
  }
  if (!Object.keys(set).length) {
    return NextResponse.json({ ok: false, error: "nothing_to_set" }, { status: 400 });
  }

  // Snapshot first. GreenAPI documents setSettings as a partial update, but
  // "documented" and "observed" are different things — the before/after diff is
  // how we would notice if it silently reset anything else.
  const before = await readSettings();

  const res = await fetch(greenEndpoint("setSettings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(set),
    signal: AbortSignal.timeout(30_000),
  });
  const applyText = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `setSettings HTTP ${res.status}`,
        body: applyText.slice(0, 400),
      },
      { status: 502 },
    );
  }

  // The instance reboots to apply, so an immediate re-read can still show the
  // old value. Poll rather than report a false failure.
  let after: Record<string, unknown> | null = null;
  let confirmed = false;
  for (let i = 0; i < 6 && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 3_000 : 6_000));
    after = await readSettings();
    if (after) {
      confirmed = Object.entries(set).every(
        ([k, v]) => String(after?.[k] ?? "") === String(v),
      );
    }
  }

  const beforeView = safeView(before);
  const afterView = safeView(after);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of new Set([...Object.keys(beforeView), ...Object.keys(afterView)])) {
    if (String(beforeView[k]) !== String(afterView[k])) {
      changed[k] = { from: beforeView[k], to: afterView[k] };
    }
  }
  // Anything that moved which we did not ask to move.
  const unexpected = Object.keys(changed).filter((k) => !(k in set));

  return NextResponse.json({
    ok: confirmed,
    requested: set,
    applied: applyText.slice(0, 200),
    confirmed,
    changed,
    unexpected,
    note: confirmed
      ? "Instance reboots to apply; inbound may pause briefly."
      : "Not confirmed yet — the instance may still be restarting. Re-run GET in a few minutes.",
    settings: afterView,
  });
}
