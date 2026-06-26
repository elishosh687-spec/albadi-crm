/**
 * Editable sales plays — stored in app_config (key `sales.plays`) so Eli can
 * edit them from the UI without code changes. Falls back to DEFAULT_PLAYS for
 * any field/key not overridden, so the panel never breaks.
 */
import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_PLAYS,
  BLOCKER_KEYS,
  type StagePlay,
  type BlockerKey,
} from "./stage-plays.he";

const KEY = "sales.plays";

export type PlaysMap = Record<BlockerKey, StagePlay>;

export async function loadPlays(): Promise<PlaysMap> {
  let stored: Partial<Record<string, Partial<StagePlay>>> = {};
  try {
    const [row] = await db
      .select()
      .from(appConfig)
      .where(eq(appConfig.key, KEY))
      .limit(1);
    if (row?.value) stored = row.value as typeof stored;
  } catch {
    /* fall back to defaults */
  }
  const merged = {} as PlaysMap;
  for (const k of BLOCKER_KEYS) {
    const s = stored[k] ?? {};
    merged[k] = {
      title: s.title ?? DEFAULT_PLAYS[k].title,
      stage: s.stage ?? DEFAULT_PLAYS[k].stage,
      lines:
        Array.isArray(s.lines) && s.lines.length ? s.lines : DEFAULT_PLAYS[k].lines,
      nextStep: s.nextStep ?? DEFAULT_PLAYS[k].nextStep,
    };
  }
  return merged;
}

export async function savePlays(input: Partial<PlaysMap>): Promise<void> {
  const clean = {} as PlaysMap;
  for (const k of BLOCKER_KEYS) {
    const p = (input[k] ?? DEFAULT_PLAYS[k]) as StagePlay;
    clean[k] = {
      title: String(p.title ?? "").slice(0, 200),
      stage: String(p.stage ?? "").slice(0, 80),
      lines: (Array.isArray(p.lines) ? p.lines : [])
        .map((l) => String(l).slice(0, 1000))
        .filter((l) => l.trim())
        .slice(0, 12),
      nextStep: String(p.nextStep ?? "").slice(0, 500),
    };
  }
  await db
    .insert(appConfig)
    .values({ key: KEY, value: clean })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: clean, updatedAt: new Date() } });
}
