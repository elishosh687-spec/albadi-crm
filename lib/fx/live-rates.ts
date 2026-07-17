/**
 * Live exchange rates — current USD→ILS, USD→CNY, CNY→ILS.
 *
 * Eli pays the factory in ¥ and shipping in $, but wants every reconciliation
 * shown in ₪ at TODAY's rate (not the rate baked into the old quote). We fetch
 * from a free, key-less endpoint (open.er-api.com), cache the result in
 * `app_config` under `fx.live` for 12h, and fall back to the stored factory
 * config rates if the network is down — so the UI always has a usable number.
 *
 * Display / reconciliation only. This does NOT touch the rates used to price
 * customer quotes (those stay manual in factory_pricing) — swapping those is an
 * explicit "apply live rate" action in Settings, never automatic.
 */

import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { getFactoryConfig, setFactoryConfig } from "@/lib/factory/config";

const KEY = "fx.live";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h
const SOURCE_URL = "https://open.er-api.com/v6/latest/USD";

export interface LiveFx {
  usdToIls: number;
  usdToCny: number;
  cnyToIls: number;
  fetchedAt: string; // ISO
  source: "live" | "cache" | "config-fallback";
}

let mem: { value: LiveFx; expiresAt: number } | null = null;

/**
 * @param opts.fresh — bypass the in-process + DB cache and force a network pull.
 *   Used by the Settings "refresh" button.
 */
export async function getLiveFx(opts?: { fresh?: boolean }): Promise<LiveFx> {
  const now = Date.now();
  if (!opts?.fresh && mem && mem.expiresAt > now) return mem.value;

  // DB cache (shared across serverless containers).
  if (!opts?.fresh) {
    const rows = await db.select().from(appConfig).where(eq(appConfig.key, KEY)).limit(1);
    const cached = rows[0]?.value as (LiveFx & { _ts?: number }) | undefined;
    if (cached?.fetchedAt) {
      const age = now - Date.parse(cached.fetchedAt);
      if (Number.isFinite(age) && age < TTL_MS) {
        const value: LiveFx = { ...cached, source: "cache" };
        mem = { value, expiresAt: now + Math.max(0, TTL_MS - age) };
        return value;
      }
    }
  }

  // Network pull.
  try {
    const res = await fetch(SOURCE_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const j = await res.json();
    const ils = Number(j?.rates?.ILS);
    const cny = Number(j?.rates?.CNY);
    if (j?.result === "success" && Number.isFinite(ils) && ils > 0 && Number.isFinite(cny) && cny > 0) {
      const value: LiveFx = {
        usdToIls: round(ils, 4),
        usdToCny: round(cny, 4),
        cnyToIls: round(ils / cny, 5),
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
      await db
        .insert(appConfig)
        .values({ key: KEY, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
      mem = { value, expiresAt: now + TTL_MS };
      return value;
    }
    throw new Error("bad payload");
  } catch {
    // Fall back to the manual factory-config rates so the UI still works offline.
    const cfg = await getFactoryConfig();
    const usdToIls = cfg.usdToIls || 3.7;
    const usdToCny = cfg.usdToCny || 7.2;
    return {
      usdToIls,
      usdToCny,
      cnyToIls: round(usdToIls / usdToCny, 5),
      fetchedAt: new Date().toISOString(),
      source: "config-fallback",
    };
  }
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * Write the live USD→ILS / USD→CNY into the factory pricing config, so ALL
 * pricing picks up today's rate. Runs daily from the cron; also callable with
 * `force` from the Settings "refresh now" button.
 *
 * Skips the write when `fxAutoUpdate` is off (unless forced) or when the live
 * pull failed (source `config-fallback` — never overwrite the rate with itself).
 * Leaves the manual `ilsToCny` alone. Returns what happened for the caller to log.
 */
export async function applyLiveFxToConfig(
  opts?: { force?: boolean }
): Promise<{ applied: boolean; reason?: string; fx: LiveFx; auto: boolean }> {
  const fx = await getLiveFx({ fresh: true });
  const cfg = await getFactoryConfig({ fresh: true });
  // Explicit opt-in: only the daily cron auto-applies when the operator turned
  // it ON (=== true). An unset flag stays manual so live rates never silently
  // move customer pricing on existing setups. The Settings "refresh now" button
  // passes force to preview/apply regardless.
  const auto = cfg.fxAutoUpdate === true;
  if (!auto && !opts?.force) return { applied: false, reason: "auto-off", fx, auto };
  if (fx.source === "config-fallback") return { applied: false, reason: "live-unavailable", fx, auto };
  await setFactoryConfig({
    ...cfg,
    usdToIls: fx.usdToIls,
    usdToCny: fx.usdToCny,
    fxUpdatedAt: fx.fetchedAt,
  });
  return { applied: true, fx, auto };
}
