"use client";

import React from "react";
import { Move, Scaling } from "lucide-react";
import { colors, radius, size, space, weight } from "@/lib/ui/tokens";

interface LogoControlsProps {
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  onScaleChange: (scale: number) => void;
  onPositionXChange: (x: number) => void;
  onPositionYChange: (y: number) => void;
  hasLogo: boolean;
}

export const LogoControls: React.FC<LogoControlsProps> = ({
  logoScale,
  logoPositionX,
  logoPositionY,
  onScaleChange,
  onPositionXChange,
  onPositionYChange,
  hasLogo,
}) => {
  const controls = [
    {
      label: "גודל לוגו",
      value: `${logoScale.toFixed(2)}x`,
      min: 0.4,
      max: 1.9,
      step: 0.05,
      current: logoScale,
      onChange: onScaleChange,
      icon: <Scaling className="size-4" />,
    },
    {
      label: "מיקום אופקי",
      value: logoPositionX.toFixed(2),
      min: -0.85,
      max: 0.85,
      step: 0.01,
      current: logoPositionX,
      onChange: onPositionXChange,
      icon: <Move className="size-4" />,
    },
    {
      label: "מיקום אנכי",
      value: logoPositionY.toFixed(2),
      min: -0.6,
      max: 0.75,
      step: 0.01,
      current: logoPositionY,
      onChange: onPositionYChange,
      icon: <Move className="size-4" />,
    },
  ] as const;

  return (
    <div className="space-y-4">
      {!hasLogo && (
        <p
          style={{
            margin: 0,
            fontSize: size.sm,
            color: colors.inkMuted,
            background: colors.surfaceMuted,
            border: `1px dashed ${colors.rule}`,
            borderRadius: radius.lg,
            padding: space.md,
          }}
        >
          העלה לוגו כדי להפעיל את הבקרים
        </p>
      )}

      {controls.map((control) => (
        <div key={control.label} className="space-y-2">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space.xs,
                fontSize: size.sm,
                fontWeight: weight.medium,
                color: colors.ink,
              }}
            >
              {control.icon}
              {control.label}
            </label>
            <span style={{ fontSize: size.xs, color: colors.inkMuted }}>{control.value}</span>
          </div>
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={control.step}
            value={control.current}
            onChange={(event) => control.onChange(Number(event.target.value))}
            disabled={!hasLogo}
            style={{ width: "100%", accentColor: colors.accent }}
          />
        </div>
      ))}
    </div>
  );
};

export default LogoControls;
