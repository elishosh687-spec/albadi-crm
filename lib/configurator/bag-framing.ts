import {
  BAG_SCENE_HEIGHT,
  ORBIT_TARGET_HEIGHT_RATIO,
  type BagModelSize,
  getBagModelSizeForProduct,
} from "@/lib/configurator/bag-models";

export const BAG_REST_Y = 0.35;
const DESKTOP_CAMERA_DISTANCE_SCALE = 0.68;

export interface BagViewerFraming {
  sceneHeight: number;
  sizeScale: number;
  orbitTarget: [number, number, number];
  cameraPosition: [number, number, number];
  minDistance: number;
  maxDistance: number;
  pedestalRadius: number;
  fov: number;
}

/** Camera + pedestal framing from product size tier and prepared mesh height. */
export function getBagViewerFraming(
  productId: string,
  preparedHeight: number,
  isCompact: boolean
): BagViewerFraming {
  const size = getBagModelSizeForProduct(productId);
  const targetSceneHeight = BAG_SCENE_HEIGHT[size];
  const sizeScale = targetSceneHeight / Math.max(preparedHeight, 0.001);
  const scaledHeight = targetSceneHeight;

  const orbitTargetY = BAG_REST_Y + scaledHeight * ORBIT_TARGET_HEIGHT_RATIO;
  const orbitTarget: [number, number, number] = [0, orbitTargetY, 0];

  const heightDelta = scaledHeight - BAG_SCENE_HEIGHT.medium;
  const baseCameraZ = 8.35 + heightDelta * 1.15;
  const cameraZ = isCompact ? baseCameraZ : baseCameraZ * DESKTOP_CAMERA_DISTANCE_SCALE;
  const cameraY = orbitTargetY + scaledHeight * 0.06;
  const cameraPosition: [number, number, number] = [0, cameraY, cameraZ];

  const minDistance = cameraZ * 0.58;
  const maxDistance = cameraZ * 1.42;
  const pedestalRadius = 1.72 * (scaledHeight / BAG_SCENE_HEIGHT.medium);

  return {
    sceneHeight: scaledHeight,
    sizeScale,
    orbitTarget,
    cameraPosition,
    minDistance,
    maxDistance,
    pedestalRadius,
    fov: isCompact ? 36 : 31,
  };
}

export function getDefaultFraming(productId: string, isCompact: boolean): BagViewerFraming {
  const size = getBagModelSizeForProduct(productId);
  const h = BAG_SCENE_HEIGHT[size];
  return getBagViewerFraming(productId, h, isCompact);
}

export function sizeLabel(size: BagModelSize): string {
  return size.charAt(0).toUpperCase() + size.slice(1);
}
