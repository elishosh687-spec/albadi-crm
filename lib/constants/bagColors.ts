/**
 * Non-woven bag color palette
 * 30+ predefined colors for the MVP configurator
 */

export interface BagColor {
  name: string;
  hex: string;
}

export const BAG_COLORS: BagColor[] = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Black", hex: "#111111" },
  { name: "Natural Beige", hex: "#D8C3A5" },
  { name: "Cream", hex: "#F5E6C8" },
  { name: "Light Grey", hex: "#CFCFCF" },
  { name: "Dark Grey", hex: "#555555" },
  { name: "Navy Blue", hex: "#0B1F4D" },
  { name: "Royal Blue", hex: "#0057B8" },
  { name: "Sky Blue", hex: "#58AEEB" },
  { name: "Turquoise", hex: "#28B8B8" },
  { name: "Green", hex: "#15803D" },
  { name: "Lime Green", hex: "#84CC16" },
  { name: "Olive", hex: "#6B7A32" },
  { name: "Yellow", hex: "#FFD700" },
  { name: "Orange", hex: "#F97316" },
  { name: "Red", hex: "#DC2626" },
  { name: "Burgundy", hex: "#7F1D1D" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Light Pink", hex: "#F9A8D4" },
  { name: "Purple", hex: "#7E22CE" },
  { name: "Lavender", hex: "#C4B5FD" },
  { name: "Brown", hex: "#7C4A2D" },
  { name: "Chocolate", hex: "#4B2E1F" },
  { name: "Teal", hex: "#0F766E" },
  { name: "Mint", hex: "#A7F3D0" },
  { name: "Coral", hex: "#FB7185" },
  { name: "Gold", hex: "#D4AF37" },
  { name: "Silver", hex: "#BFC5C8" },
  { name: "Maroon", hex: "#800000" },
  { name: "Khaki", hex: "#C3B091" },
];

export const getColorByName = (name: string): string => {
  const color = BAG_COLORS.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return color?.hex || "#111111";
};

export const getColorByHex = (hex: string): BagColor | undefined => {
  return BAG_COLORS.find((c) => c.hex === hex);
};
