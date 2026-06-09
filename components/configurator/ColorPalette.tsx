"use client";

import React, { useMemo } from "react";
import { Layers3, Palette } from "lucide-react";
import { BAG_COLORS, BAG_COLOR_CATEGORY_LABELS } from "@/lib/constants/bagColors";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";

interface ColorPaletteProps {
  selectedColor: string;
  onColorSelect: (hex: string, name: string) => void;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  selectedColor,
  onColorSelect,
}) => {
  const selected = BAG_COLORS.find((color) => color.hex === selectedColor);
  const groupedColors = useMemo(
    () =>
      BAG_COLORS.reduce<Array<{ category: string; label: string; colors: typeof BAG_COLORS }>>(
        (groups, color) => {
          const existingGroup = groups.find((group) => group.category === color.category);
          if (existingGroup) {
            existingGroup.colors.push(color);
            return groups;
          }

          groups.push({
            category: color.category,
            label: BAG_COLOR_CATEGORY_LABELS[color.category] ?? color.category,
            colors: [color],
          });
          return groups;
        },
        []
      ),
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2" style={{ color: colors.inkMuted }}>
          <Palette className="size-4" />
          <label style={{ fontSize: size.sm, fontWeight: weight.medium }}>
            קטלוג בדי אלבדי
          </label>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: space.xs,
            color: colors.inkMuted,
            fontSize: size.xs,
            whiteSpace: "nowrap",
          }}
        >
          <Layers3 className="size-3.5" />
          {BAG_COLORS.length} colors
        </span>
      </div>

      <div
        className="max-h-[520px] space-y-5 overflow-y-auto pr-1"
        style={{ scrollbarGutter: "stable" }}
      >
        {groupedColors.map((group) => (
          <section key={group.category} className="space-y-2">
            <div
              className="flex items-center justify-between gap-3"
              style={{
                borderBottom: `1px solid ${colors.ruleSoft}`,
                paddingBottom: space.xs,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  color: colors.ink,
                  fontFamily: fontStack.body,
                  fontSize: size.xs,
                  fontWeight: weight.medium,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {group.label}
              </h3>
              <span style={{ color: colors.inkMuted, fontSize: size.xs }}>
                {group.colors.length}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {group.colors.map((color) => {
                const isSelected = selectedColor === color.hex;

                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => onColorSelect(color.hex, `${color.name} (${color.sku})`)}
                    className="group transition-transform hover:-translate-y-0.5"
                    style={{
                      height: 62,
                      borderRadius: radius.lg,
                      border: isSelected ? `2px solid ${colors.accent}` : `1px solid ${colors.rule}`,
                      boxShadow: isSelected
                        ? `0 0 0 3px ${colors.accentSoft}`
                        : `0 1px 0 ${colors.ruleSoft}`,
                      background: colors.surface,
                      padding: 4,
                      cursor: "pointer",
                    }}
                    title={`${color.name} ${color.sku}`}
                    aria-label={`בחר צבע ${color.name} ${color.sku}`}
                  >
                    <span
                      style={{
                        display: "block",
                        width: "100%",
                        height: 34,
                        borderRadius: radius.md,
                        border: `1px solid ${colors.ruleSoft}`,
                        background:
                          color.hex.toLowerCase() === "#efeee9" ||
                          color.hex.toLowerCase() === "#edebdf"
                            ? `linear-gradient(135deg, ${color.hex}, #ffffff)`
                            : color.hex,
                      }}
                    />
                    <span
                      style={{
                        display: "block",
                        color: isSelected ? colors.accent : colors.inkMuted,
                        fontSize: 10,
                        fontWeight: isSelected ? weight.bold : weight.medium,
                        lineHeight: 1.3,
                        marginTop: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {color.sku}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.md,
          padding: space.md,
          borderRadius: radius.lg,
          background: colors.surfaceMuted,
          border: `1px solid ${colors.rule}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 20,
            height: 20,
            borderRadius: 9999,
            background: selected?.hex ?? "#111111",
            border: `1px solid ${colors.rule}`,
            flexShrink: 0,
          }}
        />
        <div>
          <div style={{ fontSize: size.xs, color: colors.inkMuted }}>צבע נבחר</div>
          <div style={{ fontSize: size.sm, color: colors.ink, fontWeight: weight.medium }}>
            {selected ? `${selected.name} · ${selected.sku}` : "Unknown"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColorPalette;
