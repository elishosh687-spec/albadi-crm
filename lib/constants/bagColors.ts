import fabricColors from "@/public/albadi_fabric_colors.json";

export interface BagColor {
  id: string;
  sku: string;
  name: string;
  category: string;
  hex: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  GREENS: "Greens",
  REDS_AND_PINKS: "Reds and pinks",
  YELLOWS_AND_ORANGES: "Yellows and oranges",
  BLUES: "Blues",
  PURPLE: "Purple",
  NEUTRAL_AND_NATURAL: "Neutral and natural",
  GREY_WHITE_AND_BLACK: "Grey, white and black",
};

export const BAG_COLORS: BagColor[] = fabricColors.map((color) => ({
  id: color.id,
  sku: color.sku,
  name: color.name,
  category: color.category,
  hex: color.hex,
}));

export const BAG_COLOR_CATEGORY_LABELS = CATEGORY_LABELS;

export const getColorByName = (name: string): string => {
  const color = BAG_COLORS.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return color?.hex || "#111111";
};

export const getColorByHex = (hex: string): BagColor | undefined => {
  return BAG_COLORS.find((c) => c.hex === hex);
};
