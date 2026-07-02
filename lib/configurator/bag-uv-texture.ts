import * as THREE from "three";
import {
  regionCenter,
  regionHeight,
  regionWidth,
  type UvPrintRegion,
} from "@/lib/configurator/bag-uv-regions";

export const BAG_UV_TEXTURE_SIZE = 2048;

export const LOGO_POSITION_LIMITS = {
  x: { min: -0.85, max: 0.85 },
  y: { min: -0.6, max: 0.75 },
} as const;

export interface LogoPlacementScalars {
  centerU: number;
  centerV: number;
  uScale: number;
  vScale: number;
  baseV: number;
}

/** Same control semantics as the old floating-plane decal, mapped into UV space. */
export function logoPlacementScalars(
  region: UvPrintRegion,
  footprint: number,
  height: number
): LogoPlacementScalars {
  const w = regionWidth(region);
  const h = regionHeight(region);
  const { u: centerU, v: centerV } = regionCenter(region);
  const xScale = footprint * 0.48;
  const yScale = height * 0.38;
  const baseY = height * 0.28;
  const uScale = (w / footprint) * xScale;
  const vScale = (h / height) * yScale;
  const baseV = region.minV + (baseY / height) * h;
  return { centerU, centerV, uScale, vScale, baseV };
}

export function logoStateToUvCenter(
  logoPositionX: number,
  logoPositionY: number,
  scalars: LogoPlacementScalars
) {
  return {
    u: scalars.centerU + logoPositionX * scalars.uScale,
    v: scalars.baseV + logoPositionY * scalars.vScale,
  };
}

export function uvPointToLogoState(
  u: number,
  v: number,
  scalars: LogoPlacementScalars
) {
  return {
    x: THREE.MathUtils.clamp(
      (u - scalars.centerU) / scalars.uScale,
      LOGO_POSITION_LIMITS.x.min,
      LOGO_POSITION_LIMITS.x.max
    ),
    y: THREE.MathUtils.clamp(
      (v - scalars.baseV) / scalars.vScale,
      LOGO_POSITION_LIMITS.y.min,
      LOGO_POSITION_LIMITS.y.max
    ),
  };
}

export function logoSizeInUv(
  region: UvPrintRegion,
  footprint: number,
  height: number,
  logoScale: number,
  aspectRatio: number
) {
  const w = regionWidth(region);
  const h = regionHeight(region);
  const clampedAspect = Math.max(aspectRatio, 0.65);
  const widthUv = Math.min(w * 0.72, w * 0.42 * logoScale * clampedAspect);
  const heightUv = Math.min(h * 0.42, (h * 0.42 * logoScale) / clampedAspect);
  return {
    widthUv,
    heightUv,
    widthPx: widthUv * BAG_UV_TEXTURE_SIZE,
    heightPx: heightUv * BAG_UV_TEXTURE_SIZE,
  };
}

function uvToCanvas(u: number, v: number, size: number) {
  return { x: u * size, y: (1 - v) * size };
}

function drawLogoOnRegion(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  region: UvPrintRegion,
  footprint: number,
  height: number,
  logoPositionX: number,
  logoPositionY: number,
  logoScale: number,
  logoRotationDeg: number,
  aspectRatio: number,
  mirrorU: boolean
) {
  const scalars = logoPlacementScalars(region, footprint, height);
  const { u, v } = logoStateToUvCenter(logoPositionX, logoPositionY, scalars);
  const { widthPx, heightPx } = logoSizeInUv(
    region,
    footprint,
    height,
    logoScale,
    aspectRatio
  );
  const center = uvToCanvas(u, v, BAG_UV_TEXTURE_SIZE);
  const rotationRad = THREE.MathUtils.degToRad(mirrorU ? logoRotationDeg : -logoRotationDeg);

  const clipX = region.minU * BAG_UV_TEXTURE_SIZE;
  const clipY = (1 - region.maxV) * BAG_UV_TEXTURE_SIZE;
  const clipW = (region.maxU - region.minU) * BAG_UV_TEXTURE_SIZE;
  const clipH = (region.maxV - region.minV) * BAG_UV_TEXTURE_SIZE;

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, clipW, clipH);
  ctx.clip();
  ctx.translate(center.x, center.y);
  if (mirrorU) ctx.scale(-1, 1);
  ctx.rotate(rotationRad);
  ctx.drawImage(image, -widthPx / 2, -heightPx / 2, widthPx, heightPx);
  ctx.restore();
}

export interface PaintBagUvTextureOptions {
  bagColor: string;
  logoImage?: CanvasImageSource | null;
  footprint: number;
  height: number;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  logoRotation: number;
  aspectRatio: number;
  frontRegion: UvPrintRegion;
  backRegion: UvPrintRegion;
}

export function paintBagUvTexture(
  ctx: CanvasRenderingContext2D,
  options: PaintBagUvTextureOptions
) {
  const size = BAG_UV_TEXTURE_SIZE;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = options.bagColor;
  ctx.fillRect(0, 0, size, size);

  if (!options.logoImage) return;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  drawLogoOnRegion(
    ctx,
    options.logoImage,
    options.frontRegion,
    options.footprint,
    options.height,
    options.logoPositionX,
    options.logoPositionY,
    options.logoScale,
    options.logoRotation,
    options.aspectRatio,
    false
  );

  drawLogoOnRegion(
    ctx,
    options.logoImage,
    options.backRegion,
    options.footprint,
    options.height,
    options.logoPositionX,
    options.logoPositionY,
    options.logoScale,
    options.logoRotation,
    options.aspectRatio,
    true
  );
}

export function configureBagAlbedoTexture(texture: THREE.CanvasTexture, maxAnisotropy: number) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.max(1, maxAnisotropy);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
}
