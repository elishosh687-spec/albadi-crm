"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Swiper from "swiper";
import { FreeMode, Mousewheel } from "swiper/modules";
import type { Swiper as SwiperInstance } from "swiper";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BagColor } from "@/lib/constants/bagColors";
import { colors, radius, space } from "@/lib/ui/tokens";

import "swiper/css";
import "swiper/css/free-mode";

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
  scrollToSelection?: boolean;
}

export function ColorSwatchRail({
  colors: swatches,
  selectedHex,
  onSelect,
  compact = false,
  scrollToSelection = false,
}: ColorSwatchRailProps) {
  const swiperContainerRef = useRef<HTMLDivElement>(null);
  const swiperRef = useRef<SwiperInstance | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [canScrollStart, setCanScrollStart] = useState(false);
  const [canScrollEnd, setCanScrollEnd] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [thumbWidth, setThumbWidth] = useState(40);
  const [thumbLeft, setThumbLeft] = useState(0);
  const [draggingProgress, setDraggingProgress] = useState(false);

  const swatchSize = compact ? 28 : 32;
  const anchorSize = compact ? 32 : 36;

  const syncChrome = useCallback(
    (swiper: SwiperInstance) => {
      setCanScrollStart(!swiper.isBeginning);
      setCanScrollEnd(!swiper.isEnd);
      setScrollProgress(swiper.progress);

      const track = progressRef.current;
      if (track) {
        const trackWidth = track.clientWidth;
        const width = Math.max(32, trackWidth / Math.max(swatches.length / 5.5, 1));
        const travel = Math.max(0, trackWidth - width);
        setThumbWidth(width);
        setThumbLeft(swiper.progress * travel);
      }
    },
    [swatches.length]
  );

  useEffect(() => {
    const container = swiperContainerRef.current;
    if (!container || swatches.length === 0) return;

    const swiper = new Swiper(container, {
      modules: [FreeMode, Mousewheel],
      slidesPerView: "auto",
      spaceBetween: compact ? 6 : 8,
      freeMode: {
        enabled: true,
        momentum: true,
        sticky: true,
      },
      mousewheel: {
        forceToAxis: true,
        sensitivity: 0.8,
      },
      resistanceRatio: 0.65,
      watchOverflow: true,
      on: {
        progress: (instance) => syncChrome(instance),
        slideChange: (instance) => syncChrome(instance),
        resize: (instance) => syncChrome(instance),
        init: (instance) => syncChrome(instance),
      },
    });

    swiperRef.current = swiper;
    syncChrome(swiper);

    return () => {
      swiper.destroy(true, true);
      swiperRef.current = null;
    };
  }, [compact, swatches.length, syncChrome]);

  useEffect(() => {
    const swiper = swiperRef.current;
    if (!swiper || !scrollToSelection) return;

    const index = swatches.findIndex((color) => color.hex === selectedHex);
    if (index < 0) return;

    swiper.slideTo(index, 280);
    window.requestAnimationFrame(() => syncChrome(swiper));
  }, [scrollToSelection, selectedHex, swatches, syncChrome]);

  const scrollTowardEnd = () => {
    const swiper = swiperRef.current;
    if (!swiper || swiper.isEnd) return;
    swiper.slideTo(Math.min(swiper.activeIndex + SCROLL_INDEX_STEP, swatches.length - 1), 280);
  };

  const scrollTowardStart = () => {
    const swiper = swiperRef.current;
    if (!swiper || swiper.isBeginning) return;
    swiper.slideTo(Math.max(swiper.activeIndex - SCROLL_INDEX_STEP, 0), 280);
  };

  const seekProgress = (ratio: number) => {
    const swiper = swiperRef.current;
    if (!swiper) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    swiper.setProgress(clamped, 0);
    syncChrome(swiper);
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
      <style>{`
        .color-swatch-swiper {
          overflow: hidden;
          width: 100%;
        }
        .color-swatch-swiper .swiper-wrapper {
          align-items: center;
        }
      `}</style>
      {/* Outside anchor — toward palette end (›) */}
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
        <div ref={swiperContainerRef} className="swiper color-swatch-swiper">
          <div className="swiper-wrapper">
            {swatches.map((color) => {
              const isSelected = selectedHex === color.hex;
              return (
                <div
                  key={color.id}
                  className="swiper-slide"
                  style={{ width: "auto", height: "auto" }}
                >
                  <button
                    type="button"
                    data-color-hex={color.hex}
                    title={`${color.name} · ${color.sku} · ${color.hex.toUpperCase()}`}
                    aria-label={`בחר צבע ${color.name} ${color.sku}`}
                    aria-pressed={isSelected ? "true" : "false"}
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

      {/* Outside anchor — toward palette start (‹) */}
      <button
        type="button"
        aria-label="גלול לתחילת הרשימה"
        onClick={scrollTowardStart}
        disabled={!canScrollStart}
        style={anchorButtonStyle(canScrollStart)}
      >
        <ChevronLeft className={compact ? "size-4" : "size-[18px]"} strokeWidth={2.25} />
      </button>
    </div>
  );
}

export default ColorSwatchRail;
