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

/**
 * The only keys this endpoint may write — webhook TYPE toggles, nothing else.
 *
 * Taken from a live getSettings read (2026-09-07), not from memory. There is no
 * `outgoingMessageStatusWebhook`: the flag that governs the
 * `outgoingMessageStatus` webhook — sent / delivered / read receipts for
 * messages WE send — is plain **`outgoingWebhook`**, and it was "no". That is
 * why 21 days produced 11 status events and why we could not confirm delivery
 * of anything sent during the outage.
 *
 * Deliberately excluded even though they are settings: `webhookUrl` (severing
 * it is the outage), `delaySendMessagesMilliseconds`, `proxyInstance`,
 * `sharedSession`, `enableLidMode`, `enableMessagesHistory`, `linkPreview`,
 * `autoTyping`, `markIncomingMessagesReaded*`. Those change behaviour rather
 * than observability, so they stay a human decision in the console.
 */
const WRITABLE = new Set([
  "incomingWebhook",
  "outgoingWebhook",
  "outgoingMessageWebhook",
  "outgoingAPIMessageWebhook",
  "incomingMessageStatusWebhook",
  "stateWebhook",
  "statusInstanceWebhook",
  "deviceWebhook",
  "incomingCallWebhook",
  "outgoingCallWebhook",
  "editedMessageWebhook",
  "deletedMessageWebhook",
  "pollMessageWebhook",
  "incomingBlockWebhook",
  "catalogWebhook",
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

/**
 * Never echo a credential back out, whatever GreenAPI decides to include.
 *
 * ⚠️ Filtering by KEY NAME is not enough, and this was learned the hard way on
 * 2026-09-07: the first read of this endpoint printed
 * `webhookUrl: ".../api/greenapi/webhook?secret=<50-hex>"` straight into a
 * GitHub Actions log. The key is called "webhookUrl" — it contains no "token"
 * — but the auth secret rides in its query string. The run was deleted and the
 * token rotated.
 *
 * So: strip the query string off every URL-shaped value, and redact any long
 * hex/base62 run that looks like a secret regardless of the key it sits under.
 */
function redact(v: unknown): unknown {
  if (typeof v !== "string") return v;
  let s = v;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      // Keep origin + path — that is what we actually need to eyeball. Never
      // the query, which is where the secret lives.
      s = u.searchParams.toString() ? `${u.origin}${u.pathname}?<redacted>` : s;
    } catch {
      s = "<unparseable url — redacted>";
    }
  }
  // Any remaining long opaque run is treated as a credential.
  return s.replace(/[A-Za-z0-9]{24,}/g, "<redacted>");
}

function safeView(s: Record<string, unknown> | null): Record<string, unknown> {
  if (!s) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (/token|secret|password|apikey/i.test(k)) continue;
    out[k] = redact(v);
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

  // A missing baseline is NOT evidence of a change. The first live run of this
  // endpoint proved why that distinction matters: the before-read came back
  // empty, so every key "differed" from nothing and the workflow reported all
  // 28 settings as unexpectedly modified — when in fact only the one requested
  // flag had moved. An alarm that fires on its own blind spot is worse than no
  // alarm, because the next real one gets ignored.
  const baselineAvailable = before !== null;
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  if (baselineAvailable) {
    for (const k of new Set([...Object.keys(beforeView), ...Object.keys(afterView)])) {
      if (String(beforeView[k]) !== String(afterView[k])) {
        changed[k] = { from: beforeView[k], to: afterView[k] };
      }
    }
  }
  // Anything that moved which we did not ask to move. Only meaningful when we
  // actually have something to compare against.
  const unexpected = baselineAvailable
    ? Object.keys(changed).filter((k) => !(k in set))
    : [];

  return NextResponse.json({
    ok: confirmed,
    requested: set,
    applied: applyText.slice(0, 200),
    confirmed,
    baselineAvailable,
    changed,
    unexpected,
    note: !baselineAvailable
      ? "Applied, but the before-snapshot could not be read, so no drift check was possible — compare against a prior GET by hand."
      : confirmed
        ? "Instance reboots to apply; inbound may pause briefly."
        : "Not confirmed yet — the instance may still be restarting. Re-run GET in a few minutes.",
    settings: afterView,
  });
}
