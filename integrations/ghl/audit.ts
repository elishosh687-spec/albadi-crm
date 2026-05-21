// Server-only mirror audit log. Writes to bridge_events so we can read the
// progression of forwardMessage from a single DB query when something fails
// silently. Wrapped in try/catch so audit failures never break the mirror.
//
// Read with:
//   SELECT * FROM bridge_events
//   WHERE type LIKE 'ghl_mirror.%' AND occurred_at > now() - interval '5 minutes'
//   ORDER BY occurred_at DESC;
import { db } from "@/lib/db";
import { bridgeEvents } from "@/drizzle/schema";

export type MirrorStage =
  | "attempt"
  | "skip"
  | "success"
  | "fallback_note"
  | "fail";

export async function auditMirror(
  stage: MirrorStage,
  sid: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const evtId = `mirror:${sid}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await db
      .insert(bridgeEvents)
      .values({
        evtId,
        type: `ghl_mirror.${stage}`,
        tenant: "albadi-mirror",
        occurredAt: new Date(),
        payload: { sid, ...data } as unknown as any,
      })
      .onConflictDoNothing();
  } catch (e) {
    // Never block the mirror path on an audit hiccup.
    console.warn(
      "[ghl_mirror.audit] insert failed",
      stage,
      e instanceof Error ? e.message : String(e)
    );
  }
}
