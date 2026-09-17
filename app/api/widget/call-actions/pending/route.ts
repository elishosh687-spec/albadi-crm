import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import {
  callActionCandidates,
  callRecordingImports,
  elevenlabsCallImports,
  leads,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog("widget", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const candidates = await db
    .select()
    .from(callActionCandidates)
    .where(inArray(callActionCandidates.status, ["pending", "failed"]))
    .orderBy(desc(callActionCandidates.createdAt))
    .limit(100);

  const rows = await Promise.all(
    candidates.map(async (candidate) => {
      const [lead, sourceCall] = await Promise.all([
        candidate.leadSid
          ? db
              .select({ name: leads.name, phone: leads.phoneE164, stage: leads.pipelineStage })
              .from(leads)
              .where(eq(leads.manychatSubId, candidate.leadSid))
              .limit(1)
              .then((result) => result[0] ?? null)
          : Promise.resolve(null),
        candidate.source === "ghl"
          ? db
              .select({ transcript: callRecordingImports.transcript, startedAt: callRecordingImports.callStartedAt })
              .from(callRecordingImports)
              .where(eq(callRecordingImports.ghlMessageId, candidate.sourceRecordId))
              .limit(1)
              .then((result) => result[0] ?? null)
          : db
              .select({ transcript: elevenlabsCallImports.transcript, startedAt: elevenlabsCallImports.callStartedAt })
              .from(elevenlabsCallImports)
              .where(eq(elevenlabsCallImports.conversationId, candidate.sourceRecordId))
              .limit(1)
              .then((result) => result[0] ?? null),
      ]);
      const locationId = process.env.GHL_LOCATION_ID?.trim();
      return {
        ...candidate,
        createdAt: candidate.createdAt.toISOString(),
        updatedAt: candidate.updatedAt.toISOString(),
        decidedAt: candidate.decidedAt?.toISOString() ?? null,
        lastErrorAt: candidate.lastErrorAt?.toISOString() ?? null,
        leadName: lead?.name ?? null,
        leadPhone: lead?.phone ?? null,
        leadStage: lead?.stage ?? null,
        transcript: sourceCall?.transcript ?? null,
        callStartedAt: sourceCall?.startedAt?.toISOString() ?? null,
        ghlUrl:
          locationId && candidate.ghlContactId
            ? `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${candidate.ghlContactId}`
            : null,
      };
    }),
  );

  const failed = rows.filter((row) => row.status === "failed").length;
  const oldest = rows.length
    ? rows.reduce((min, row) => (row.createdAt < min ? row.createdAt : min), rows[0].createdAt)
    : null;
  return NextResponse.json({
    ok: true,
    count: rows.length,
    health: { pending: rows.length - failed, failed, oldestPendingAt: oldest },
    candidates: rows,
  });
});
