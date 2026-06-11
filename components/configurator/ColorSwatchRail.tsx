"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "keen-slider/keen-slider.min.css";
import { useKeenSlider } from "keen-slider/react";
import type { KeenSliderInstance } from "keen-slider";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BagColor } from "@/lib/constants/bagColors";
import { colors, radius, space } from "@/lib/ui/tokens";

const SCROLL_INDEX_STEP = 5;

const PILL_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.92)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderRadius: radius.full,
  border: `1px solid ${colors.ruleSoft}`,
  boxShadow: "0 8px 28px rgba(28,24,21,0.12)",
};

interface ColorSwatchRailProps {
  colors: BagColor[];
  selectedHex: string;
  onSelect: (hex: string) => void;
  compact?: boolean;
  /** When false the rail may be `display:none` — slider needs update on show. */
  visible?: boolean;
}

export function ColorSwatchRail({
  colors: swatches,
  selectedHex,
  onSelect,
  compact = false,
  visible = true,
}: ColorSwatchRailProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const [canScrollStart, setCanScrollStart] = useState(false);
  const [canScrollEnd, setCanScrollEnd] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [thumbWidth, setThumbWidth] = useState(40);
  const [thumbLeft, setThumbLeft] = useState(0);
  const [draggingProgress, setDraggingProgress] = useState(false);

  const swatchSize = compact ? 28 : 32;
  const anchorSize = compact ? 32 : 36;
  const slideGap = compact ? 6 : 8;

  const selectedHexRef = useRef(selectedHex);
  selectedHexRef.current = selectedHex;
  const prevSelectedHexRef = useRef(selectedHex);

  const syncChrome = useCallback(
    (slider: KeenSliderInstance) => {
      const { progress } = slider.track.details;
      setCanScrollStart(progress > 0.001);
      setCanScrollEnd(progress < 0.999);
      setScrollProgress(progress);

      const track = progressRef.current;
      if (track) {
        const trackWidth = track.clientWidth;
        const width = Math.max(32, trackWidth / Math.max(swatches.length / 5.5, 1));
        const travel = Math.max(0, trackWidth - width);
        setThumbWidth(width);
        setThumbLeft(progress * travel);
      }
    },
    [swatches.length]
  );

  const scrollToSelected = useCallback(
    (slider: KeenSliderInstance, instant = false) => {
      const index = swatches.findIndex((color) => color.hex === selectedHexRef.current);
      if (index < 0) return;
      slider.moveToIdx(index, false, instant ? { duration: 0 } : undefined);
      syncChrome(slider);
    },
    [swatches, syncChrome]
  );

  const sliderOptions = useMemo(
    () => ({
      mode: "free-snap" as const,
      drag: true,
      rubberband: true,
      slides: {
        perView: "auto" as const,
        spacing: slideGap,
      },
      detailsChanged(slider: KeenSliderInstance) {
        syncChrome(slider);
      },
      created(slider: KeenSliderInstance) {
        window.requestAnimationFrame(() => {
          scrollToSelected(slider, true);
        });
      },
    }),
    [slideGap, syncChrome, scrollToSelected]
  );

  const [sliderRef, instanceRef] = useKeenSlider<HTMLDivElement>(sliderOptions);

  useEffect(() => {
    if (prevSelectedHexRef.current === selectedHex) return;
    prevSelectedHexRef.current = selectedHex;
    const slider = instanceRef.current;
    if (!slider) return;
    scrollToSelected(slider, false);
  }, [selectedHex, instanceRef, scrollToSelected]);

  useEffect(() => {
    if (!visible) return;
    const slider = instanceRef.current;
    if (!slider) return;
    slider.update();
    window.requestAnimationFrame(() => {
      scrollToSelected(slider, true);
    });
  }, [visible, instanceRef, scrollToSelected]);

  const scrollTowardEnd = () => {
    const slider = instanceRef.current;
    if (!slider) return;
    const current = slider.track.details.rel;
    slider.moveToIdx(Math.min(current + SCROLL_INDEX_STEP, swatches.length - 1));
  };

  const scrollTowardStart = () => {
    const slider = instanceRef.current;
    if (!slider) return;
    const current = slider.track.details.rel;
    slider.moveToIdx(Math.max(current - SCROLL_INDEX_STEP, 0));
  };

  const seekProgress = (ratio: number) => {
    const slider = instanceRef.current;
    if (!slider || swatches.length <= 1) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    slider.moveToIdx(Math.round(clamped * (swatches.length - 1)), false, { duration: 0 });
    syncChrome(slider);
  };

  const handleProgressPointer = (clientX: number) => {
    const track = progressRef.current;
    if (!track || track.clientWidth <= 0) return;
    const rect = track.getBoundingClientRect();
    seekProgress((clientX - rect.left) / rect.width);
  };

  if (swatches.length === 0) return null;

  const anchorButtonStyle = (enabled: boolean): React.CSSProperties => ({
    flexShrink: 0,
    width: anchorSize,
    height: anchorSize,
    display: "grid",
    placeItems: "center",
    borderRadius: radius.full,
    border: `1px solid ${enabled ? colors.rule : colors.ruleSoft}`,
    background: enabled ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.55)",
    color: enabled ? colors.ink : colors.inkSubtle,
    cursor: enabled ? "pointer" : "default",
    boxShadow: enabled ? "0 4px 16px rgba(28,24,21,0.12)" : "none",
    transition: "opacity 160ms ease, box-shadow 160ms ease",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 8 : 12,
        width: "100%",
        userSelect: "none",
      }}
    >
      <button
        type="button"
        aria-label="גלול לסוף הרשימה"
        onClick={scrollTowardEnd}
        disabled={!canScrollEnd}
        style={anchorButtonStyle(canScrollEnd)}
      >
        <ChevronRight className={compact ? "size-4" : "size-[18px]"} strokeWidth={2.25} />
      </button>

      <div
        style={{
          ...PILL_STYLE,
          position: "relative",
          flex: 1,
          minWidth: 0,
          padding: `${space.md}px ${space.lg}px`,
        }}
      >
        <div ref={sliderRef} className="keen-slider color-swatch-keen">
          {swatches.map((color) => {
            const isSelected = selectedHex === color.hex;
            return (
              <div
                key={color.id}
                className="keen-slider__slide"
                style={{
                  minWidth: swatchSize,
                  maxWidth: swatchSize,
                  overflow: "visible",
                }}
              >
                <button
                  type="button"
                  data-color-hex={color.hex}
                  title={`${color.name} · ${color.sku} · ${color.hex.toUpperCase()}`}
                  aria-label={`בחר צבע ${color.name} ${color.sku}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(color.hex)}
                  className="transition-transform duration-150 ease-out hover:scale-105"
                  style={{
                    width: swatchSize,
                    height: swatchSize,
                    borderRadius: radius.full,
                    border: `2px solid ${colors.surface}`,
                    background: color.hex,
                    cursor: "pointer",
                    boxShadow: isSelected
                      ? `0 0 0 2px ${colors.accent}, 0 4px 12px rgba(28,24,21,0.16)`
                      : `0 0 0 1px ${colors.rule}`,
                    transform: isSelected ? "scale(1.1)" : undefined,
                  }}
                />
              </div>
            );
          })}
        </div>

        {swatches.length > 1 ? (
          <div
            ref={progressRef}
            role="slider"
            aria-label="מיקום ברשימת הצבעים"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(scrollProgress * 100)}
            onPointerDown={(event) => {
              event.preventDefault();
              setDraggingProgress(true);
              handleProgressPointer(event.clientX);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!draggingProgress) return;
              handleProgressPointer(event.clientX);
            }}
            onPointerUp={(event) => {
              setDraggingProgress(false);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => setDraggingProgress(false)}
            style={{
              position: "relative",
              height: compact ? 4 : 5,
              marginTop: space.xs,
              borderRadius: radius.full,
              background: colors.ruleSoft,
              cursor: "pointer",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: thumbLeft,
                width: thumbWidth,
                borderRadius: radius.full,
                background: colors.inkMuted,
                transition: draggingProgress ? "none" : "left 120ms ease, width 120ms ease",
              }}
            />
          </div>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="גלול לתחילת הרשימה"
        onClick={scrollTowardStart}
        disabled={!canScrollStart}
        style={anchorButtonStyle(canScrollStart)}
      >
        <ChevronLeft className={compact ? "size-4" : "size-[18px]"} strokeWidth={2.25} />
      </button>

      <style>{`.color-swatch-keen { overflow: hidden; width: 100%; }`}</style>
    </div>
  );
}

export default ColorSwatchRail;
