// GHL Marketplace OAuth helpers. Used to obtain access tokens with broader
// scopes than the Private Integration Token can hold — specifically
// `conversations/providers.write`, which unlocks Custom Conversation Provider
// registration for Phase 1F outbound chat routing.
//
// Token lifecycle:
//   1. User clicks Install in GHL Marketplace → GHL redirects to
//      /api/integrations/oauth/callback?code=...&locationId=...
//      (path intentionally does NOT contain "ghl" — GHL UI validators
//      reject any URL containing ghl/highlevel/gohighlevel.)
//   2. callback POSTs the code to /oauth/token → access_token + refresh_token
//   3. Tokens stored in `ghl_oauth_tokens` (one row per location)
//   4. getValidAccessToken(locationId) returns a fresh access token;
//      auto-refreshes when within 5min of expiry.

import { db } from "@/lib/db";
import { ghlOauthTokens } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export const GHL_OAUTH_BASE = "https://services.leadconnectorhq.com";
const TOKEN_URL = `${GHL_OAUTH_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function requireOAuthClientId(): string {
  const v = readEnv("GHL_OAUTH_CLIENT_ID");
  if (!v) throw new Error("GHL_OAUTH_CLIENT_ID is not set");
  return v;
}

export function requireOAuthClientSecret(): string {
  const v = readEnv("GHL_OAUTH_CLIENT_SECRET");
  if (!v) throw new Error("GHL_OAUTH_CLIENT_SECRET is not set");
  return v;
}

export function oauthRedirectUri(): string {
  return (
    readEnv("GHL_OAUTH_REDIRECT_URI") ||
    "https://albadi-crm.vercel.app/api/integrations/oauth/callback"
  );
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  locationId?: string;
  companyId?: string;
  userType?: string;
}

async function postTokenEndpoint(
  body: Record<string, string>
): Promise<TokenResponse> {
  const form = new URLSearchParams(body);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GHL OAuth token endpoint ${res.status}: ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/**
 * Exchange the install-time `code` for tokens. Persists to DB.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  locationId: string;
  accessToken: string;
}> {
  const tokens = await postTokenEndpoint({
    client_id: requireOAuthClientId(),
    client_secret: requireOAuthClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthRedirectUri(),
  });
  if (!tokens.locationId) {
    throw new Error(
      "GHL OAuth response missing locationId — got " + JSON.stringify(tokens)
    );
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await persistTokens({
    locationId: tokens.locationId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scope: tokens.scope ?? null,
    companyId: tokens.companyId ?? null,
    userType: tokens.userType ?? null,
  });
  return { locationId: tokens.locationId, accessToken: tokens.access_token };
}

async function persistTokens(row: {
  locationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string | null;
  companyId: string | null;
  userType: string | null;
}): Promise<void> {
  await db
    .insert(ghlOauthTokens)
    .values({
      locationId: row.locationId,
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: row.expiresAt,
      scope: row.scope,
      companyId: row.companyId,
      userType: row.userType,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ghlOauthTokens.locationId,
      set: {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresAt: row.expiresAt,
        scope: row.scope,
        companyId: row.companyId,
        userType: row.userType,
        updatedAt: new Date(),
      },
    });
}

/**
 * Return a non-expired access token for the location. Auto-refreshes when
 * within `REFRESH_BUFFER_MS` of expiry.
 */
export async function getValidAccessToken(
  locationId: string
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.locationId, locationId))
    .limit(1);
  if (!row) return null;
  const expiresMs = row.expiresAt.getTime();
  if (expiresMs - Date.now() > REFRESH_BUFFER_MS) return row.accessToken;
  // Refresh.
  const tokens = await postTokenEndpoint({
    client_id: requireOAuthClientId(),
    client_secret: requireOAuthClientSecret(),
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
  });
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await persistTokens({
    locationId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scope: tokens.scope ?? row.scope,
    companyId: tokens.companyId ?? row.companyId,
    userType: tokens.userType ?? row.userType,
  });
  return tokens.access_token;
}

/**
 * Build the install URL the user clicks to start the OAuth flow.
 */
export function buildInstallUrl(scopes: string[]): string {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: oauthRedirectUri(),
    client_id: requireOAuthClientId(),
    scope: scopes.join(" "),
  });
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params.toString()}`;
}

export const DEFAULT_SCOPES = [
  "contacts.write",
  "contacts.readonly",
  "opportunities.write",
  "opportunities.readonly",
  "conversations.write",
  "conversations.readonly",
  "conversations/message.write",
  "conversations/message.readonly",
  "locations/customFields.write",
  "locations/customFields.readonly",
  "medias.write",
  "medias.readonly",
  "users.readonly",
] as const;
