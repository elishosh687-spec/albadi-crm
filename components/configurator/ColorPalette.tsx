"use client";

import React from "react";
import { BAG_COLORS, BagColor } from "@/lib/constants/bagColors";

interface ColorPaletteProps {
  selectedColor: string;
  onColorSelect: (hex: string, name: string) => void;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  selectedColor,
  onColorSelect,
}) => {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-gray-700">
        Bag Color
      </label>
      <div className="grid grid-cols-5 gap-3">
        {BAG_COLORS.map((color) => (
          <button
            key={color.hex}
            onClick={() => onColorSelect(color.hex, color.name)}
            className={`h-12 rounded-lg transition-all border-2 hover:scale-105 ${
              selectedColor === color.hex
                ? "border-gray-800 ring-2 ring-offset-2 ring-gray-500"
                : "border-gray-300 hover:border-gray-500"
            }`}
            style={{ backgroundColor: color.hex }}
            title={color.name}
          />
        ))}
      </div>
      <p className="text-xs text-gray-600 mt-2">
        Selected:{" "}
        <span className="font-semibold">
          {BAG_COLORS.find((c) => c.hex === selectedColor)?.name || "Unknown"}
        </span>
      </p>
    </div>
  );
};

export default ColorPalette;
