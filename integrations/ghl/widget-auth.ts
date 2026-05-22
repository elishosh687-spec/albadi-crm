// Server-only iframe widget auth.
//
// Phase 1 — shared secret (single user, low blast radius). GHL Custom Menu
// Link URL embeds `?widget_token=<value>`. Backend verifies on every widget
// route + on `/api/factory/quote-preview` GETs from widget context.
//
// Phase 2 — rotate to HMAC(secret, contactId+timestamp) with 1h TTL.

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export const GHL_WIDGET_TOKEN = readEnv("GHL_WIDGET_TOKEN");

export const WIDGET_ALLOWED_FRAME_ANCESTORS =
  readEnv("WIDGET_ALLOWED_FRAME_ANCESTORS") ||
  "'self' https://app.gohighlevel.com https://*.leadconnectorhq.com https://*.gohighlevel.com https://*.msgsndr.com";

/**
 * Verify a widget token from query string OR header.
 * Returns true if the token matches GHL_WIDGET_TOKEN.
 * If GHL_WIDGET_TOKEN is unset (dev), returns true to avoid blocking work.
 */
export function verifyWidgetToken(token: string | null | undefined): boolean {
  if (!GHL_WIDGET_TOKEN) return true; // unset = pass (dev / before bootstrap)
  if (!token) return false;
  if (token.length !== GHL_WIDGET_TOKEN.length) return false;
  // Constant-time compare to avoid timing leaks (single-user low risk but
  // cheap to do right).
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ GHL_WIDGET_TOKEN.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Standard iframe-friendly response headers. Removes X-Frame-Options DENY
 * (Next.js default) and sets a CSP frame-ancestors allowlist so GHL can
 * embed our widget pages.
 */
export function iframeHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": `frame-ancestors ${WIDGET_ALLOWED_FRAME_ANCESTORS}`,
    // Some browsers prefer X-Frame-Options ALLOW-FROM; modern browsers ignore
    // it in favor of CSP frame-ancestors. Omit X-Frame-Options entirely so
    // the CSP wins (Next.js doesn't add one by default for pages).
  };
}
