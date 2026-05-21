/**
 * Convenience redirect to the GHL Marketplace install flow. Visit this URL
 * in a browser to start OAuth — GHL prompts the user to pick a location and
 * approve the requested scopes. After approval GHL redirects to
 * /api/integrations/oauth/callback?code=... to complete the exchange.
 *
 * Note: path intentionally omits "ghl" — GHL UI rejects URLs containing
 * ghl/highlevel/gohighlevel when creating Marketplace apps or webhooks.
 *
 * Public on purpose (the redirect target itself is from a verified GHL
 * Marketplace app and the only state we trust later is the code returned
 * after the user logs in to GHL).
 */
import { NextResponse } from "next/server";
import { buildInstallUrl, DEFAULT_SCOPES } from "@/integrations/ghl/oauth";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const url = buildInstallUrl([...DEFAULT_SCOPES]);
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`OAuth not configured: ${msg}`, { status: 500 });
  }
}
