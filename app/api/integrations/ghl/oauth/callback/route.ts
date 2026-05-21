/**
 * GHL Marketplace OAuth callback.
 *
 * GHL redirects here after the user installs the Private App in a location.
 * Query: ?code=<auth_code>&locationId=<id>
 *
 * We POST the code to /oauth/token, persist access + refresh tokens in the
 * `ghl_oauth_tokens` table, and render a small confirmation page.
 *
 * No middleware protection — relies on the unguessable `code` from GHL.
 */
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/integrations/ghl/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return new NextResponse("missing code", { status: 400 });
  }
  try {
    const { locationId } = await exchangeCodeForTokens(code);
    const html = `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>GHL Installed</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b10;color:#fff;padding:48px;max-width:640px;margin:auto}h1{color:#4ade80}code{background:#1f2937;padding:2px 6px;border-radius:4px}</style>
</head><body>
<h1>✅ אישור הצליח</h1>
<p>App מותקן בlocation <code>${locationId}</code>. הtokens נשמרו.</p>
<p>הצעד הבא: רישום Custom Conversation Provider →
<code>npx tsx integrations/ghl/register-conversation-provider.ts</code></p>
</body></html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ghl.oauth] callback failed", msg);
    return new NextResponse("OAuth exchange failed: " + msg, { status: 500 });
  }
}
