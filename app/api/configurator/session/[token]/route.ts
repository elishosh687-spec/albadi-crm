import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { loadConfiguratorSession } from "@/lib/configurator/sessions";

export const runtime = "nodejs";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const OPTIONS = withRequestLog("configurator", async (_req: NextRequest, log) => {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
});

export const GET = withRequestLog("configurator", async (
  _req: NextRequest,
  log,
  { params }: { params: Promise<{ token: string }> }
) => {
  const { token } = await params;
  const session = await loadConfiguratorSession(token);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_not_found" },
      { status: 404, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      manychatSubId: session.manychatSubId,
      name: session.name ?? "",
      phone: session.phone ?? "",
      email: session.email ?? "",
    },
    { headers: corsHeaders() }
  );
});
