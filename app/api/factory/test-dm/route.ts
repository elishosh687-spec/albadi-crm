/**
 * Debug-only endpoint: triggers sendEliDM to verify the WhatsApp bridge
 * is wired correctly. Same Bearer auth as /api/factory/refresh.
 *
 * Returns whether the underlying call threw and what the JID resolution
 * produced. Strip this once we're done debugging.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendBridgeMessage, resolveJidFromPhone } from "@/lib/bridge/client";
import { isJid } from "@/lib/bridge/jid";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const raw = (process.env.ELI_NOTIFY_JID ?? "").replace(/^﻿/, "").trim();
  const dryRun = process.env.BRIDGE_DRY_RUN === "1";
  const useBridge = process.env.USE_BRIDGE === "1";
  const result: Record<string, unknown> = {
    eliNotifyJidPresent: !!raw,
    eliNotifyJidLooksLikeJid: raw ? isJid(raw) : null,
    dryRun,
    useBridge,
    bridgeBase: process.env.BRIDGE_BASE ?? "(unset)",
  };

  if (!raw) return NextResponse.json({ ...result, status: "skipped_no_jid" });

  try {
    let jid = raw;
    if (!isJid(raw)) {
      const resolved = await resolveJidFromPhone(raw);
      result.resolvedJid = resolved;
      if (!resolved) {
        return NextResponse.json({ ...result, status: "could_not_resolve" });
      }
      jid = resolved;
    }
    const sendResult = await sendBridgeMessage(
      jid,
      `🧪 DM test from /api/factory/test-dm at ${new Date().toISOString()}`
    );
    return NextResponse.json({
      ...result,
      status: "sent",
      sendResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ...result,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6) : undefined,
      },
      { status: 500 }
    );
  }
}
