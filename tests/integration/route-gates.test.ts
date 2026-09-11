/**
 * Who guards every door — all of app/api/**\/route.ts, each in exactly ONE
 * declared bucket:
 *
 *   bearer      — declares `authorized()` / `authed()`; exercised by
 *                 authorized-sweep.test.ts (no bearer → 401).
 *   own-gate    — its own check under another name / secret: widgetAuthed,
 *                 salesAuthed, verifyWidgetToken, GHL_INBOUND_SECRET, the import
 *                 secrets, the GreenAPI token, the bridge HMAC, the GHL webhook
 *                 signature, inline BOT_SECRET / CRON_SECRET. Exercised here:
 *                 every exported method, no credential → 401/403.
 *   middleware  — no check of its own; middleware.ts gates the prefix (cookie /
 *                 widget_token / cron bearer on /api/factory/*). Asserted against
 *                 middleware.ts itself, since calling the handler skips it.
 *   public      — deliberately open, each with a reason. Documented, not called.
 *   unprotected — a finding. Kept as `it.fails` until fixed, never weakened.
 *
 * A new route that matches nothing fails the coverage test with instructions.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const ROOT = path.resolve(__dirname, "../..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}
const ALL = walk(path.join(ROOT, "app/api")).map((f) => path.relative(ROOT, f)).sort();
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const middlewareSrc = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");

/** app/api/x/[id]/route.ts → /api/x/ci */
function urlPath(rel: string): string {
  return "/" + path.relative("app", path.dirname(rel)).replace(/\[\.\.\.[^\]]+\]/g, "ci").replace(/\[[^\]]+\]/g, "ci");
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

const BEARER_RE = /function (authorized|authed)\(/;
const OWN_GATE_RE =
  /widgetAuthed|salesAuthed|verifyWidgetToken|GHL_INBOUND_SECRET|FB_IMPORT_SECRET|WEBSITE_IMPORT_SECRET|GHL_OUTBOUND_SECRET|authOk\(|verifySignature\(|process\.env\.BOT_SECRET|process\.env\.CRON_SECRET|process\.env\.ADMIN_PASSWORD/;

/** Deliberately open. The reason is the documentation. */
const PUBLIC: Record<string, string> = {
  "app/api/auth/login/route.ts": "the login itself — compares the password, sets the albadi_auth cookie",
  "app/api/auth/logout/route.ts": "clears the cookie; nothing to protect",
  "app/api/configurator/quote/route.ts": "customer-facing 3D configurator pricing + catalog (CORS *); same numbers the public site shows",
  "app/api/configurator/designs/route.ts": "customer-facing 3D configurator saves a design (CORS *); a customer has no credential — spam is the accepted risk, it writes only configurator_* rows",
  "app/api/configurator/session/[token]/route.ts": "the session token IS the credential (unguessable, in the path)",
  "app/api/elevenlabs/recording/[id]/route.ts": "audio proxy GHL must fetch unauthenticated; the conversation id is unguessable (CLAUDE.md)",
  "app/api/integrations/media/[name]/route.ts": "media proxy GHL must fetch unauthenticated; the source URL in the path is the only secret (route header)",
  "app/api/bridge/media/[id]/route.ts": "media proxy with an HMAC-signed id — a forged id fails the MAC",
  "app/api/integrations/install/route.ts": "OAuth start — redirects to GHL, holds nothing",
  "app/api/integrations/oauth/callback/route.ts": "OAuth callback — exchanges a one-time code GHL issues",
};

/** Methods on own-gate routes that are meant to answer without a credential. */
const PUBLIC_METHODS: Record<string, Partial<Record<Method, string>>> = {
  "app/api/greenapi/webhook/route.ts": { GET: "liveness info line, no data" },
  "app/api/bridge/webhook/route.ts": { GET: "liveness info line, no data" },
  "app/api/ghl/app-webhook/route.ts": { GET: "liveness info line, no data" },
};

/**
 * Methods on own-gate routes whose gate is middleware.ts, not the route: the
 * route carries a bearer check on ONE method (the cron GET) and leaves the
 * dashboard's POST to the cookie. Calling the handler skips middleware, so
 * these are not exercised; the middleware test above covers the prefix.
 */
const MIDDLEWARE_METHODS: Record<string, Partial<Record<Method, string>>> = {
  "app/api/factory/refresh/route.ts": { POST: "dashboard 🔄 button — cookie via middleware; GET is the cron with the bearer" },
};

/**
 * Routes that validate the body BEFORE the credential (400 on an empty body).
 * Probe them with a well-formed body and no token, so the gate itself answers.
 */
const PROBE_BODIES: Record<string, string> = {
  "app/api/configurator/send-to-customer/route.ts": JSON.stringify({
    sessionToken: "ci",
    manychatSubId: "test:ci-gate",
    imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  }),
};

/** Findings — real gaps, reported to Eli 2026-09-11. `it.fails` until fixed. */
const UNPROTECTED: Record<string, string> = {
  // 2026-09-11: POST /api/ai/chat was here (no auth, streamed an LLM digest of
  // the lead table to anyone). Fixed the same day — it now requires the
  // dashboard cookie or a Bearer BOT_SECRET and lives in the `bearer` bucket.
};

function bucketOf(rel: string): "bearer" | "own-gate" | "middleware" | "public" | "unprotected" | null {
  if (rel in UNPROTECTED) return "unprotected";
  if (rel in PUBLIC) return "public";
  const s = src(rel);
  if (BEARER_RE.test(s)) return "bearer";
  if (OWN_GATE_RE.test(s)) return "own-gate";
  if (urlPath(rel).startsWith("/api/factory/")) return "middleware";
  return null;
}

const byBucket = new Map<string, string[]>();
for (const rel of ALL) {
  const b = bucketOf(rel) ?? "UNCLASSIFIED";
  byBucket.set(b, [...(byBucket.get(b) ?? []), rel]);
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("every API route is in exactly one gate bucket", () => {
  it("nothing is unclassified", () => {
    const u = byBucket.get("UNCLASSIFIED") ?? [];
    expect(
      u,
      `routes with no recognisable gate — add a check, or a PUBLIC entry with a reason, or an UNPROTECTED finding:\n${u.join("\n")}`,
    ).toEqual([]);
  });

  it("the buckets are the expected shape (sanity — the scanner still sees the tree)", () => {
    expect(ALL.length).toBeGreaterThan(140);
    expect((byBucket.get("bearer") ?? []).length).toBeGreaterThan(25);
    expect((byBucket.get("own-gate") ?? []).length).toBeGreaterThan(60);
    expect((byBucket.get("middleware") ?? []).length).toBeGreaterThan(10);
  });

  it("PUBLIC and UNPROTECTED entries point at routes that still exist, and PUBLIC ones have not grown a gate", () => {
    for (const rel of [...Object.keys(PUBLIC), ...Object.keys(UNPROTECTED), ...Object.keys(PUBLIC_METHODS)]) {
      expect(ALL, `${rel} no longer exists — prune the entry`).toContain(rel);
    }
    for (const rel of Object.keys(PUBLIC)) {
      // If someone adds a real check, the entry is stale and hides the route from the exercise below.
      const s = src(rel);
      expect(BEARER_RE.test(s), `${rel} now declares a bearer check — drop it from PUBLIC`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// middleware-gated: assert the gate that the handler itself does not carry
// ---------------------------------------------------------------------------

describe("middleware-gated routes (/api/factory/* with no check of their own)", () => {
  it("middleware.ts still matches the prefix and still demands the cookie for it", () => {
    expect(middlewareSrc).toContain('"/api/factory/:path*"');
    expect(middlewareSrc).toMatch(/path\.startsWith\("\/api\/factory\/"\)[\s\S]{0,400}albadi_auth/);
  });

  it("the only public factory path in middleware is the customer PDF, GET-only", () => {
    expect(middlewareSrc).toMatch(/req\.method === "GET" &&\s*\/\^\\\/api\\\/factory\\\/\[\^\/\]\+\\\/pdf\$\/\.test\(path\)/);
  });

  it("lists which routes lean on middleware (so a move out of /api/factory/ is a conscious act)", () => {
    const list = byBucket.get("middleware") ?? [];
    for (const rel of list) expect(urlPath(rel).startsWith("/api/factory/"), rel).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// own-gate: no credential → 401 / 403, every exported method
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label}: no response in ${ms}ms — is work happening before the gate?`)), ms)),
  ]);
}

describe("own-gate routes refuse a request with no credential", () => {
  for (const rel of byBucket.get("own-gate") ?? []) {
    it(rel, async () => {
      const mod = (await import(path.join(ROOT, rel))) as Record<string, unknown>;
      const exported = METHODS.filter((m) => typeof mod[m] === "function");
      expect(exported.length, `${rel} exports no HTTP method`).toBeGreaterThan(0);
      for (const m of exported) {
        if (PUBLIC_METHODS[rel]?.[m]) continue;
        if (MIDDLEWARE_METHODS[rel]?.[m]) {
          expect(urlPath(rel).startsWith("/api/factory/"), `${rel} ${m} claims middleware gating but is not under /api/factory/`).toBe(true);
          continue;
        }
        const handler = mod[m] as (req: NextRequest, ctx: unknown) => Promise<Response>;
        const req = new NextRequest(new URL(`http://localhost${urlPath(rel)}`), {
          method: m,
          ...(m === "GET" ? {} : { body: PROBE_BODIES[rel] ?? "{}", headers: { "content-type": "application/json" } }),
        });
        const res = await withTimeout(
          handler(req, { params: Promise.resolve({ id: "ci", sid: "ci", token: "ci", name: "ci" }) }),
          15_000,
          `${rel} ${m}`,
        );
        expect([401, 403], `${rel} ${m} without a credential answered ${res.status}`).toContain(res.status);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// findings
// ---------------------------------------------------------------------------

describe("findings (it.fails until fixed — reported, not weakened)", () => {
  // Fixed 2026-09-11 (was a finding: no gate at all). Kept as a plain test so
  // the fix cannot quietly regress.
  it("POST /api/ai/chat refuses a request with no credential", async () => {
    const mod = (await import(path.join(ROOT, "app/api/ai/chat/route.ts"))) as { POST: (r: NextRequest, c: unknown) => Promise<Response> };
    const res = await mod.POST(
      new NextRequest(new URL("http://localhost/api/ai/chat"), { method: "POST", body: JSON.stringify({ message: "מי הלידים החמים?" }), headers: { "content-type": "application/json" } }),
      undefined,
    );
    expect([401, 403]).toContain(res.status);
  });

  // Fixed 2026-09-11 (was a finding: the GHL conversation-provider hook — a
  // POST makes the CRM WhatsApp a lead — failed OPEN while GHL_OUTBOUND_SECRET
  // was unset, and it was unset in production for a month). Now a missing
  // secret refuses with a distinct reason. Plain test so it cannot regress.
  it("POST /api/integrations/outbound refuses when GHL_OUTBOUND_SECRET is unset", async () => {
    const saved = process.env.GHL_OUTBOUND_SECRET;
    delete process.env.GHL_OUTBOUND_SECRET;
    try {
      const mod = (await import(path.join(ROOT, "app/api/integrations/outbound/route.ts"))) as { POST: (r: NextRequest, c: unknown) => Promise<Response> };
      const res = await mod.POST(
        new NextRequest(new URL("http://localhost/api/integrations/outbound"), { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
        undefined,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ reason: "secret_not_configured" });
    } finally {
      process.env.GHL_OUTBOUND_SECRET = saved;
    }
  });
});
