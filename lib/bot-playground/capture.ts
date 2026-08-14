/**
 * Outbound capture sink for the bot playground.
 *
 * The playground runs the REAL bot handlers (handleInbound /
 * handleDecisionInbound) so what Eli sees is exactly what a customer would
 * get. That means every send the bot performs must be intercepted before it
 * reaches WhatsApp.
 *
 * Why AsyncLocalStorage and not BRIDGE_DRY_RUN: the dry-run flag is read off
 * `process.env`, which is process-wide. Flipping it per request inside a Next
 * route would silently mute a real customer webhook running in the same
 * lambda. ALS scopes the interception to the one async call tree the
 * playground started — concurrent real traffic is untouched. It also keeps
 * the messages (dry-run just logs them to stdout and drops them).
 *
 * Hooked into the three send choke points:
 *   - sendBridgeMessage      (lib/bridge/client.ts) — text/media/buttons/polls,
 *                             covers the Green delegation and sendEliDM
 *   - sendCompanyTemplate    (lib/bridge/client.ts) — bypasses sendBridgeMessage
 *   - sendEliDM              (lib/notify/eli.ts)    — labelled separately
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type CapturedKind = "message" | "poll" | "media" | "template" | "eli_dm";

export interface CapturedSend {
  kind: CapturedKind;
  /** Body text as the customer would see it (poll question for polls). */
  text: string;
  /** Poll options, when kind === "poll". Playground renders them as chips. */
  options?: string[];
  /** Interactive button titles, when the bot sent buttons instead of a poll. */
  buttons?: string[];
  /** Media URL/path for media sends. */
  mediaPath?: string;
  mediaFilename?: string;
  sender: "bot" | "eli";
  recipient?: string;
  at: string;
}

const store = new AsyncLocalStorage<CapturedSend[]>();

/** True while executing inside `runCaptured` — send paths must not hit the wire. */
export function isCapturing(): boolean {
  return store.getStore() !== undefined;
}

/**
 * Record an outbound. Returns false when no capture is active, which tells the
 * caller to proceed with a real send.
 */
export function captureSend(send: Omit<CapturedSend, "at">): boolean {
  const sink = store.getStore();
  if (!sink) return false;
  sink.push({ ...send, at: new Date().toISOString() });
  return true;
}

/**
 * Run `fn` with outbound capture active. Every send performed anywhere inside
 * (including awaited helpers and DB-write side paths) lands in `sends` instead
 * of WhatsApp.
 */
export async function runCaptured<T>(
  fn: () => Promise<T>
): Promise<{ result: T; sends: CapturedSend[] }> {
  const sink: CapturedSend[] = [];
  const result = await store.run(sink, fn);
  return { result, sends: sink };
}

/** Synthetic id handed back to the bot in place of a real WhatsApp message id. */
export function playgroundMessageId(): string {
  return `playground:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}
