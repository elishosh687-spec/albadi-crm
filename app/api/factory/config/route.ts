/**
 * GET /api/factory/config — returns the factory_pricing JSONB row for the
 * client-side FinalizeModal so it can recompute pricing live as the user
 * drags the profit slider.
 *
 * PUT /api/factory/config — overwrites the config (admin only — guarded by
 * middleware cookie).
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { getFactoryConfig, setFactoryConfig } from "@/lib/factory/config";

export const runtime = "nodejs";

export const GET = withRequestLog("factory", async (_req: NextRequest, log) => {
  // Admin UI (FinalizeModal, Settings reload-after-save) — always bypass the
  // in-process cache so the latest write is visible immediately.
  const config = await getFactoryConfig({ fresh: true });
  return NextResponse.json({ ok: true, config });
});

export const PUT = withRequestLog("factory", async (req: NextRequest, log) => {
  try {
    const body = await req.json();
    await setFactoryConfig(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("config.save_failed", err);
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }
});
