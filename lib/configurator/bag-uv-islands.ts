import type { BagUvRegions, UvPrintRegion } from "@/lib/configurator/bag-uv-regions";

/**
 * Manual UV print islands per GLB path (values in 0–1 UV space).
 * Paste overrides here after tuning with ?uvDebug=1 on /configurator.
 *
 * Example:
 * "/TEST_LARGE.glb": {
 *   front: { minU: 0.12, maxU: 0.48, minV: 0.18, maxV: 0.82 },
 *   back:  { minU: 0.52, maxU: 0.88, minV: 0.18, maxV: 0.82 },
 * },
 */
export const BAG_UV_ISLAND_OVERRIDES: Partial<Record<string, BagUvRegions>> = {
  // "/TEST_LARGE.glb": { front: {...}, back: {...} },
};

export function cloneUvRegions(regions: BagUvRegions): BagUvRegions {
  return {
    front: { ...regions.front },
    back: { ...regions.back },
  };
}

export function regionsToConfigSnippet(modelPath: string, regions: BagUvRegions): string {
  const fmt = (r: UvPrintRegion) =>
    `{ minU: ${round4(r.minU)}, maxU: ${round4(r.maxU)}, minV: ${round4(r.minV)}, maxV: ${round4(r.maxV)} }`;
  return [
    `  "${modelPath}": {`,
    `    front: ${fmt(regions.front)},`,
    `    back: ${fmt(regions.back)},`,
    `  },`,
  ].join("\n");
}

export function regionsToJson(modelPath: string, regions: BagUvRegions, source: string) {
  return JSON.stringify(
    {
      modelPath,
      source,
      front: regions.front,
      back: regions.back,
    },
    null,
    2
  );
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

/** Manual file override wins, then live debug draft, then auto-detected regions. */
export function resolveBagUvRegions(
  modelPath: string,
  autoRegions: BagUvRegions | null,
  debugDraft?: BagUvRegions | null
): BagUvRegions | null {
  const manual = BAG_UV_ISLAND_OVERRIDES[modelPath];
  if (manual) return cloneUvRegions(manual);
  if (debugDraft) return cloneUvRegions(debugDraft);
  return autoRegions ? cloneUvRegions(autoRegions) : null;
}

export const UV_DEBUG_STORAGE_KEY = "albadi.configurator.uvDebugDraft";

export function loadUvDebugDraft(modelPath: string): BagUvRegions | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UV_DEBUG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, BagUvRegions>;
    const draft = parsed[modelPath];
    if (!draft?.front || !draft?.back) return null;
    return cloneUvRegions(draft);
  } catch {
    return null;
  }
}

export function saveUvDebugDraft(modelPath: string, regions: BagUvRegions) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(UV_DEBUG_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, BagUvRegions>) : {};
    parsed[modelPath] = cloneUvRegions(regions);
    window.localStorage.setItem(UV_DEBUG_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore quota / private mode
  }
}
