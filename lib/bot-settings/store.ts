/**
 * Server-side reader/writer for bot settings.
 *
 * Stored in `app_config` under `bot.settings` (JSONB) — the same pattern as
 * factory_pricing / sales.plays. Deliberately NOT `bot_config`: that table is
 * TEXT key/value and nothing has ever read from it.
 *
 * Cached for a few seconds so a single webhook turn (which reads settings from
 * several call sites) does one query, while an edit in the settings screen
 * still takes effect on the next message rather than needing a redeploy.
 */
import { db } from "../db";
import { appConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  BotSettings,
  DEFAULT_BOT_SETTINGS,
  normalizeBotSettings,
} from "./schema";

const KEY = "bot.settings";
const TTL_MS = 5000;

let cache: { at: number; value: BotSettings } | null = null;

export async function getBotSettings(opts?: { fresh?: boolean }): Promise<BotSettings> {
  if (!opts?.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const [row] = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, KEY))
      .limit(1);
    const value = normalizeBotSettings(row?.value);
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    // Never let a settings read break the bot — fall back to the defaults that
    // were hardcoded before this table existed.
    console.error("[bot-settings] load failed, using defaults", e);
    return DEFAULT_BOT_SETTINGS;
  }
}

export async function saveBotSettings(raw: unknown): Promise<BotSettings> {
  const value = normalizeBotSettings(raw);
  await db
    .insert(appConfig)
    .values({ key: KEY, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
  cache = { at: Date.now(), value };
  return value;
}

/** Drop the cache — used by the settings screen right after a save. */
export function invalidateBotSettings(): void {
  cache = null;
}
