import * as THREE from "three";
import type { BagUvRegions } from "@/lib/configurator/bag-uv-regions";

export const DEFAULT_UV_MAP_SIZE = 2048;

const FACE_NORMAL_THRESHOLD = 0.55;
const EXTERIOR_SHELL_FRACTION = 0.12;

export type UvTriangleKind = "front" | "back" | "other";

export interface ExtractUvMapOptions {
  size?: number;
  /** Fit canvas to actual UV bounds (recommended when UVs are not 0–1). */
  fitToBounds?: boolean;
  padding?: number;
  background?: string;
  wireframeColor?: string;
  frontColor?: string;
  backColor?: string;
  otherFill?: string;
  /** Filled triangles + wireframe edges. */
  colorCodeExterior?: boolean;
  islandOverlay?: BagUvRegions | null;
}

export interface UvMapBounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

function classifyTriangle(
  posAttr: THREE.BufferAttribute,
  ia: number,
  ib: number,
  ic: number,
  frontShellZ: number,
  backShellZ: number
): UvTriangleKind {
  const vA = new THREE.Vector3().fromBufferAttribute(posAttr, ia);
  const vB = new THREE.Vector3().fromBufferAttribute(posAttr, ib);
  const vC = new THREE.Vector3().fromBufferAttribute(posAttr, ic);
  const edge1 = new THREE.Vector3().subVectors(vB, vA);
  const edge2 = new THREE.Vector3().subVectors(vC, vA);
  const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
  const avgZ = (vA.z + vB.z + vC.z) / 3;

  if (normal.z > FACE_NORMAL_THRESHOLD && avgZ >= frontShellZ) return "front";
  if (normal.z < -FACE_NORMAL_THRESHOLD && avgZ <= backShellZ) return "back";
  return "other";
}

function computeAllUvBounds(uvAttr: THREE.BufferAttribute): UvMapBounds {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, maxU, minV, maxV };
}

function uvToPixel(
  u: number,
  v: number,
  size: number,
  bounds: UvMapBounds,
  paddingPx: number
) {
  const inner = size - paddingPx * 2;
  const uSpan = Math.max(bounds.maxU - bounds.minU, 0.0001);
  const vSpan = Math.max(bounds.maxV - bounds.minV, 0.0001);
  return {
    x: paddingPx + ((u - bounds.minU) / uSpan) * inner,
    y: paddingPx + (1 - (v - bounds.minV) / vSpan) * inner,
  };
}

function drawIslandOverlay(
  ctx: CanvasRenderingContext2D,
  regions: BagUvRegions,
  size: number,
  bounds: UvMapBounds,
  paddingPx: number
) {
  const drawRect = (region: BagUvRegions["front"], stroke: string, label: string) => {
    const tl = uvToPixel(region.minU, region.maxV, size, bounds, paddingPx);
    const br = uvToPixel(region.maxU, region.minV, size, bounds, paddingPx);
    const w = br.x - tl.x;
    const h = br.y - tl.y;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.strokeRect(tl.x, tl.y, w, h);
    ctx.fillStyle = stroke;
    ctx.font = "bold 22px monospace";
    ctx.fillText(label, tl.x + 6, tl.y + 24);
  };
  drawRect(regions.front, "#f472b6", "front");
  drawRect(regions.back, "#60a5fa", "back");
}

/**
 * Rasterize mesh UV layout to a canvas (wireframe unwrap).
 * Works in browser — pass prepared bag geometry from prepareBagMesh().
 */
export function extractUvMapToCanvas(
  geometry: THREE.BufferGeometry,
  options: ExtractUvMapOptions = {}
): HTMLCanvasElement | null {
  const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!uvAttr || !posAttr) return null;

  const size = options.size ?? DEFAULT_UV_MAP_SIZE;
  const paddingPx = options.padding ?? 24;
  const fitToBounds = options.fitToBounds ?? true;
  const bounds = fitToBounds
    ? computeAllUvBounds(uvAttr)
    : { minU: 0, maxU: 1, minV: 0, maxV: 1 };

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = options.background ?? "#1a1714";
  ctx.fillRect(0, 0, size, size);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const minZ = box?.min.z ?? -1;
  const maxZ = box?.max.z ?? 1;
  const depth = Math.max(maxZ - minZ, 0.0001);
  const frontShellZ = maxZ - depth * EXTERIOR_SHELL_FRACTION;
  const backShellZ = minZ + depth * EXTERIOR_SHELL_FRACTION;

  const index = geometry.getIndex();
  const colorCode = options.colorCodeExterior ?? true;
  const wireColor = options.wireframeColor ?? "rgba(245,240,232,0.35)";
  const frontColor = options.frontColor ?? "rgba(244,114,182,0.55)";
  const backColor = options.backColor ?? "rgba(96,165,250,0.55)";
  const otherFill = options.otherFill ?? "rgba(80,75,70,0.25)";

  const drawTriangle = (ia: number, ib: number, ic: number) => {
    const u0 = uvAttr.getX(ia);
    const v0 = uvAttr.getY(ia);
    const u1 = uvAttr.getX(ib);
    const v1 = uvAttr.getY(ib);
    const u2 = uvAttr.getX(ic);
    const v2 = uvAttr.getY(ic);

    const p0 = uvToPixel(u0, v0, size, bounds, paddingPx);
    const p1 = uvToPixel(u1, v1, size, bounds, paddingPx);
    const p2 = uvToPixel(u2, v2, size, bounds, paddingPx);

    if (colorCode) {
      const kind = classifyTriangle(posAttr, ia, ib, ic, frontShellZ, backShellZ);
      ctx.fillStyle =
        kind === "front" ? frontColor : kind === "back" ? backColor : otherFill;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.stroke();
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      drawTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      drawTriangle(i, i + 1, i + 2);
    }
  }

  if (options.islandOverlay) {
    drawIslandOverlay(ctx, options.islandOverlay, size, bounds, paddingPx);
  }

  // Axis labels
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "14px monospace";
  ctx.fillText(
    `U ${bounds.minU.toFixed(3)}–${bounds.maxU.toFixed(3)}  V ${bounds.minV.toFixed(3)}–${bounds.maxV.toFixed(3)}`,
    paddingPx,
    size - 8
  );

  return canvas;
}

export function extractUvMapDataUrl(
  geometry: THREE.BufferGeometry,
  options?: ExtractUvMapOptions
): string | null {
  const canvas = extractUvMapToCanvas(geometry, options);
  if (!canvas) return null;
  return canvas.toDataURL("image/png");
}

export function downloadUvMapPng(
  geometry: THREE.BufferGeometry,
  filename: string,
  options?: ExtractUvMapOptions
) {
  const dataUrl = extractUvMapDataUrl(geometry, options);
  if (!dataUrl) return false;

  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  anchor.click();
  return true;
}
