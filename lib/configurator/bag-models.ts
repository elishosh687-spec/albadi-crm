import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

/** GLB assets in /public — matched to factory H×D×W (cm). */
export type BagModelSize = "small" | "medium" | "large";

export const BAG_GLB_BY_SIZE: Record<BagModelSize, string> = {
  small: "/Reusable_Bag_Small.glb",
  medium: "/Reusable_Bag_Medium.glb",
  large: "/Reusable_Bag_Large.glb",
};

/** Legacy single-size model (pre–size-split). */
export const LEGACY_BAG_GLB = "/Rusable_Bag.glb";

/** Reference dimensions per GLB (factory notation: H × D × W in cm). */
export const BAG_MODEL_REFERENCE: Record<BagModelSize, { h: number; d: number; w: number }> = {
  small: { h: 20, d: 8, w: 25 },
  medium: { h: 30, d: 10, w: 30 },
  large: { h: 40, d: 12, w: 30 },
};

export const ALL_BAG_GLB_PATHS = [
  ...Object.values(BAG_GLB_BY_SIZE),
  LEGACY_BAG_GLB,
] as const;

/** Parse factory size strings: `H20*D8*W25` or flat `H30*W40`. */
export function parseFactoryDimensions(
  dimensions: string
): { h: number; d: number; w: number } | null {
  const trimmed = dimensions.trim();
  const withDepth = trimmed.match(/^H(\d+)\*D(\d+)\*W(\d+)$/i);
  if (withDepth) {
    return { h: Number(withDepth[1]), d: Number(withDepth[2]), w: Number(withDepth[3]) };
  }
  const flat = trimmed.match(/^H(\d+)\*W(\d+)$/i);
  if (flat) {
    const h = Number(flat[1]);
    const w = Number(flat[2]);
    return { h, d: Math.min(h, w) * 0.35, w };
  }
  return null;
}

/** Pick closest Small / Medium / Large GLB by Euclidean distance in H,D,W space. */
export function classifyBagModelSize(h: number, d: number, w: number): BagModelSize {
  let best: BagModelSize = "medium";
  let bestDist = Infinity;
  for (const size of Object.keys(BAG_MODEL_REFERENCE) as BagModelSize[]) {
    const ref = BAG_MODEL_REFERENCE[size];
    const dist =
      (h - ref.h) ** 2 + (d - ref.d) ** 2 + (w - ref.w) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = size;
    }
  }
  return best;
}

export function getBagModelSizeForProduct(productId: string): BagModelSize {
  const product = DEFAULT_CONFIG.products.find((p) => p.id === productId);
  if (!product) return "medium";
  const parsed = parseFactoryDimensions(product.dimensions);
  if (!parsed) return "medium";
  return classifyBagModelSize(parsed.h, parsed.d, parsed.w);
}

export function getBagGlbPathForProduct(productId: string): string {
  return BAG_GLB_BY_SIZE[getBagModelSizeForProduct(productId)];
}

export function getBagGlbPathForDimensions(dimensions: string): string {
  const parsed = parseFactoryDimensions(dimensions);
  if (!parsed) return BAG_GLB_BY_SIZE.medium;
  return BAG_GLB_BY_SIZE[classifyBagModelSize(parsed.h, parsed.d, parsed.w)];
}

/**
 * Visual size/model options for the design tool. Each maps to a representative
 * factory productId so BagViewer3D's `productId` prop still selects the right
 * GLB via getBagModelSizeForProduct(). No pricing meaning — purely visual.
 */
export interface BagSizeOption {
  size: BagModelSize;
  productId: string;
  label: string;
  dimensions: string;
}

export const BAG_SIZE_OPTIONS: readonly BagSizeOption[] = [
  { size: "small", productId: "p1", label: "קטן", dimensions: "20×8×25 ס״מ" },
  { size: "medium", productId: "p2", label: "בינוני", dimensions: "30×10×30 ס״מ" },
  { size: "large", productId: "p4", label: "גדול", dimensions: "40×15×50 ס״מ" },
];

export const DEFAULT_BAG_SIZE_OPTION = BAG_SIZE_OPTIONS[1];

/** Normalized scene height per size tier (world units, bottom at y = 0). */
export const BAG_SCENE_HEIGHT: Record<BagModelSize, number> = {
  small: 1.48,
  medium: 1.88,
  large: 2.32,
};

/** Orbit / camera look-at height = BAG_REST_Y + height * ORBIT_TARGET_HEIGHT_RATIO */
export const ORBIT_TARGET_HEIGHT_RATIO = 0.45;
