/**
 * POST /api/factory/import-feishu
 *
 * Re-imports quotes that exist in the Feishu sheet but were deleted from the
 * DB, preserving the sheet's quotation number. Auth: dashboard cookie OR
 * ?widget_token=<T> (both allowed by middleware for /api/factory/*).
 */

import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { importFromFeishu } from "@/lib/factory/server/import-from-feishu";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withRequestLog("factory", async (_req, log) => {
  try {
    const result = await importFromFeishu();
    return NextResponse.json(result);
  } catch (e) {
    log.error("import_feishu.failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "import_failed" },
      { status: 500 }
    );
  }
});
