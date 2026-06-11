import { NextRequest, NextResponse } from "next/server";
import { loadConfiguratorSession } from "@/lib/configurator/sessions";

export const runtime = "nodejs";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
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
}
