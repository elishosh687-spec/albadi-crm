/**
 * GET /api/factory/config — returns the factory_pricing JSONB row for the
 * client-side FinalizeModal so it can recompute pricing live as the user
 * drags the profit slider.
 *
 * PUT /api/factory/config — overwrites the config (admin only — guarded by
 * middleware cookie).
 */

import { NextRequest, NextResponse } from "next/server";
import { getFactoryConfig, setFactoryConfig } from "@/lib/factory/config";

export const runtime = "nodejs";

export async function GET() {
  // Admin UI (FinalizeModal, Settings reload-after-save) — always bypass the
  // in-process cache so the latest write is visible immediately.
  const config = await getFactoryConfig({ fresh: true });
  return NextResponse.json({ ok: true, config });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    await setFactoryConfig(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }
}
