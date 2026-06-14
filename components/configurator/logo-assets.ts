export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
export const ALLOWED_LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];
export const MAX_LOGO_FILE_SIZE = 8 * 1024 * 1024;
export const MAX_TEXTURE_DIMENSION = 4096;
export const MIN_TEXTURE_DIMENSION = 1200;
export const TARGET_TEXTURE_DIMENSION = 2048;

export function isSupportedLogoFile(file: File) {
  if (ALLOWED_LOGO_TYPES.includes(file.type)) return true;
  const lower = file.name.toLowerCase();
  return ALLOWED_LOGO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isSvgFile(file: File) {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("שגיאה בקריאת הקובץ"));
    };
    reader.onerror = () => reject(new Error("שגיאה בקריאת הקובץ"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("לא ניתן היה לטעון את התמונה"));
    image.src = src;
  });
}

function drawToPngDataUrl(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("שגיאה בעיבוד התמונה");
  }

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/png");
}

function resolveTextureDimensions(sourceWidth: number, sourceHeight: number) {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const longest = Math.max(safeWidth, safeHeight);

  if (longest > MAX_TEXTURE_DIMENSION) {
    const scale = MAX_TEXTURE_DIMENSION / longest;
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale)),
    };
  }

  if (longest < MIN_TEXTURE_DIMENSION) {
    const scale = MIN_TEXTURE_DIMENSION / longest;
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale)),
    };
  }

  if (longest < TARGET_TEXTURE_DIMENSION) {
    const scale = TARGET_TEXTURE_DIMENSION / longest;
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale)),
    };
  }

  return { width: safeWidth, height: safeHeight };
}

async function buildHighQualityTextureUrl(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const { width, height } = resolveTextureDimensions(sourceWidth, sourceHeight);

  if (width === sourceWidth && height === sourceHeight) {
    return dataUrl;
  }

  return drawToPngDataUrl(image, width, height);
}

async function rasterizeSvgToHighResPng(file: File) {
  const svgText = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  if (doc.querySelector("parsererror")) {
    throw new Error("קובץ SVG לא תקין");
  }

  let width = Number.parseFloat(svg.getAttribute("width") || "");
  let height = Number.parseFloat(svg.getAttribute("height") || "");
  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value));

  if ((!width || !height) && viewBox?.length === 4) {
    width = viewBox[2];
    height = viewBox[3];
  }

  if (!width || !height) {
    width = TARGET_TEXTURE_DIMENSION;
    height = TARGET_TEXTURE_DIMENSION;
  }

  const { width: outWidth, height: outHeight } = resolveTextureDimensions(width, height);
  svg.setAttribute("width", String(outWidth));
  svg.setAttribute("height", String(outHeight));

  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadImage(objectUrl);
    return drawToPngDataUrl(image, outWidth, outHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processLogoFile(file: File) {
  if (!isSupportedLogoFile(file)) {
    throw new Error("פורמט לא נתמך — PNG, JPG, JPEG או SVG בלבד");
  }

  if (file.size > MAX_LOGO_FILE_SIZE) {
    throw new Error("הקובץ גדול מדי — עד 8MB");
  }

  const textureUrl = isSvgFile(file)
    ? await rasterizeSvgToHighResPng(file)
    : await buildHighQualityTextureUrl(await readFileAsDataUrl(file));

  return {
    fileName: file.name,
    previewUrl: textureUrl,
    textureUrl,
  };
}
