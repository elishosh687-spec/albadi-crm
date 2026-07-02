import * as THREE from "three";

export interface UvPrintRegion {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

export interface BagUvRegions {
  front: UvPrintRegion;
  back: UvPrintRegion;
}

const FACE_NORMAL_THRESHOLD = 0.55;
/** Only triangles on the outer shell (excludes interior faces that share UVs). */
const EXTERIOR_SHELL_FRACTION = 0.12;

function boundsFromUvPairs(pairs: number[]): UvPrintRegion | null {
  if (pairs.length < 4) return null;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < pairs.length; i += 2) {
    const u = pairs[i];
    const v = pairs[i + 1];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  if (!Number.isFinite(minU)) return null;
  return { minU, maxU, minV, maxV };
}

/**
 * Derive front/back print UV bounds from triangle normals in prepared mesh space
 * (+Z front, −Z back after prepareBagMesh centering).
 */
export function computeBagUvRegions(geometry: THREE.BufferGeometry): BagUvRegions | null {
  return computeBagUvRegionsInternal(geometry, false);
}

/**
 * Exterior-only islands — ignores interior/backfaces of the outer shell so the
 * logo does not appear on the inside of the bag opening.
 */
export function computeExteriorBagUvRegions(geometry: THREE.BufferGeometry): BagUvRegions | null {
  return computeBagUvRegionsInternal(geometry, true);
}

function computeBagUvRegionsInternal(
  geometry: THREE.BufferGeometry,
  exteriorOnly: boolean
): BagUvRegions | null {
  const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!uvAttr || !posAttr) return null;

  const index = geometry.getIndex();
  const frontUvs: number[] = [];
  const backUvs: number[] = [];

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const minZ = box?.min.z ?? -1;
  const maxZ = box?.max.z ?? 1;
  const depth = Math.max(maxZ - minZ, 0.0001);
  const frontShellZ = maxZ - depth * EXTERIOR_SHELL_FRACTION;
  const backShellZ = minZ + depth * EXTERIOR_SHELL_FRACTION;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const collectTriangle = (ia: number, ib: number, ic: number) => {
    vA.fromBufferAttribute(posAttr, ia);
    vB.fromBufferAttribute(posAttr, ib);
    vC.fromBufferAttribute(posAttr, ic);
    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    normal.crossVectors(edge1, edge2).normalize();
    const avgZ = (vA.z + vB.z + vC.z) / 3;

    let target: number[] | null = null;
    if (normal.z > FACE_NORMAL_THRESHOLD) {
      if (!exteriorOnly || avgZ >= frontShellZ) target = frontUvs;
    } else if (normal.z < -FACE_NORMAL_THRESHOLD) {
      if (!exteriorOnly || avgZ <= backShellZ) target = backUvs;
    }
    if (!target) return;

    for (const idx of [ia, ib, ic]) {
      target.push(uvAttr.getX(idx), uvAttr.getY(idx));
    }
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      collectTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      collectTriangle(i, i + 1, i + 2);
    }
  }

  const front = boundsFromUvPairs(frontUvs);
  const back = boundsFromUvPairs(backUvs);
  if (!front || !back) return null;
  return { front, back };
}

export function regionWidth(region: UvPrintRegion) {
  return Math.max(region.maxU - region.minU, 0.0001);
}

export function regionHeight(region: UvPrintRegion) {
  return Math.max(region.maxV - region.minV, 0.0001);
}

export function regionCenter(region: UvPrintRegion) {
  return {
    u: (region.minU + region.maxU) / 2,
    v: (region.minV + region.maxV) / 2,
  };
}
