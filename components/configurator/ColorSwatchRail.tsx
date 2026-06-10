"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BagColor } from "@/lib/constants/bagColors";
import { colors, radius, space } from "@/lib/ui/tokens";

const PILL_SURFACE = "rgba(255,255,255,0.98)";
const FADE_WIDTH = 36;
const VIEWPORT_PAD_INLINE = 34;
const SCROLL_STEP = 132;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [thumbDragging, setThumbDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const swatchSize = compact ? 30 : 34;
  const slideGap = compact ? space.sm : 10;
  const viewportPadInline = compact ? 28 : VIEWPORT_PAD_INLINE;

  const syncChrome = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const { scrollLeft, scrollWidth, clientWidth } = element;
    const maxScroll = Math.max(0, scrollWidth - clientWidth);

    setCanScrollPrev(scrollLeft > 2);
    setCanScrollNext(scrollLeft < maxScroll - 2);
    setScrollProgress(maxScroll > 0 ? scrollLeft / maxScroll : 0);
  }, []);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const trackElement = trackRef.current;
    if (!scrollElement) return;

    syncChrome();

    const resizeObserver = new ResizeObserver(() => {
      syncChrome();
      if (trackElement) setTrackWidth(trackElement.clientWidth);
    });

    resizeObserver.observe(scrollElement);
    if (trackElement) {
      resizeObserver.observe(trackElement);
      setTrackWidth(trackElement.clientWidth);
    }

    scrollElement.addEventListener("scroll", syncChrome, { passive: true });

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      scrollElement.scrollLeft += event.deltaY;
    };
    scrollElement.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      scrollElement.removeEventListener("scroll", syncChrome);
      scrollElement.removeEventListener("wheel", onWheel);
    };
  }, [syncChrome, swatches.length]);

  useEffect(() => {
    if (!scrollToSelection) return;

    const selectedButton = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-color-hex="${selectedHex}"]`
    );
    selectedButton?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });

    const frame = window.requestAnimationFrame(syncChrome);
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToSelection, selectedHex, syncChrome]);

  const scrollByStep = useCallback((direction: -1 | 1) => {
    scrollRef.current?.scrollBy({
      left: direction * SCROLL_STEP,
      behavior: "smooth",
    });
  }, []);

  const seekToProgress = useCallback((progress: number) => {
    const element = scrollRef.current;
    if (!element) return;

    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    if (maxScroll <= 0) return;

    const clamped = Math.max(0, Math.min(1, progress));
    element.scrollLeft = clamped * maxScroll;
    syncChrome();
  }, [syncChrome]);

  const handleTrackPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || track.clientWidth <= 0) return;
      const rect = track.getBoundingClientRect();
      seekToProgress((clientX - rect.left) / rect.width);
    },
    [seekToProgress]
  );

  const thumbWidthPx = Math.max(
    compact ? 28 : 36,
    trackWidth > 0 ? trackWidth / Math.max(swatches.length / 5.5, 1) : compact ? 28 : 36
  );
  const thumbLeftPx =
    trackWidth > thumbWidthPx ? scrollProgress * (trackWidth - thumbWidthPx) : 0;

  const edgeMask = `linear-gradient(to right, ${
    canScrollPrev ? "transparent 0%, black 28px" : "black 0%"
  }, black calc(100% - ${canScrollNext ? "28px" : "0px"}), ${
    canScrollNext ? "transparent 100%" : "black 100%"
  })`;

  if (swatches.length === 0) {
    return null;
  }

  return (
    <div style={{ position: "relative", width: "100%", userSelect: "none" }}>
      <style>{`
        .color-swatch-rail-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .color-swatch-rail-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {canScrollPrev ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: 0,
            bottom: 22,
            width: FADE_WIDTH,
            zIndex: 4,
            pointerEvents: "none",
            background: `linear-gradient(to right, ${PILL_SURFACE} 15%, rgba(255,255,255,0))`,
          }}
        />
      ) : null}

      {canScrollNext ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            top: 0,
            bottom: 22,
            width: FADE_WIDTH,
            zIndex: 4,
            pointerEvents: "none",
            background: `linear-gradient(to left, ${PILL_SURFACE} 15%, rgba(255,255,255,0))`,
          }}
        />
      ) : null}

      {canScrollPrev ? (
        <button
          type="button"
          aria-label="צבעים קודמים"
          onClick={() => scrollByStep(-1)}
          style={{
            position: "absolute",
            insetInlineStart: 2,
            top: "calc(50% - 10px)",
            transform: "translateY(-50%)",
            zIndex: 5,
            width: compact ? 26 : 30,
            height: compact ? 26 : 30,
            display: "grid",
            placeItems: "center",
            borderRadius: radius.full,
            border: `1px solid ${colors.rule}`,
            background: "rgba(255,255,255,0.95)",
            color: colors.ink,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(28,24,21,0.12)",
          }}
        >
          <ChevronLeft className={compact ? "size-3.5" : "size-4"} />
        </button>
      ) : null}

      {canScrollNext ? (
        <button
          type="button"
          aria-label="צבעים הבאים"
          onClick={() => scrollByStep(1)}
          style={{
            position: "absolute",
            insetInlineEnd: 2,
            top: "calc(50% - 10px)",
            transform: "translateY(-50%)",
            zIndex: 5,
            width: compact ? 26 : 30,
            height: compact ? 26 : 30,
            display: "grid",
            placeItems: "center",
            borderRadius: radius.full,
            border: `1px solid ${colors.rule}`,
            background: "rgba(255,255,255,0.95)",
            color: colors.ink,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(28,24,21,0.12)",
          }}
        >
          <ChevronRight className={compact ? "size-3.5" : "size-4"} />
        </button>
      ) : null}

      <div
        ref={scrollRef}
        className="color-swatch-rail-scroll"
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          paddingInline: viewportPadInline,
          paddingBlock: `${space.xs}px 12px`,
          WebkitMaskImage: edgeMask,
          maskImage: edgeMask,
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "smooth",
          scrollSnapType: "x proximity",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: "max-content",
            gap: slideGap,
          }}
        >
          {swatches.map((color) => {
            const isSelected = selectedHex === color.hex;
            return (
              <button
                key={color.id}
                type="button"
                data-color-hex={color.hex}
                title={`${color.name} · ${color.sku} · ${color.hex.toUpperCase()}`}
                aria-label={`בחר צבע ${color.name} ${color.sku}`}
                aria-pressed={isSelected ? "true" : "false"}
                onClick={() => onSelect(color.hex)}
                className="transition-all duration-200 ease-out hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  width: swatchSize,
                  height: swatchSize,
                  flexShrink: 0,
                  borderRadius: radius.full,
                  border: `2px solid ${colors.surface}`,
                  background: color.hex,
                  cursor: "pointer",
                  boxShadow: isSelected
                    ? `0 0 0 2px ${colors.accent}, 0 6px 16px rgba(28,24,21,0.18)`
                    : `0 0 0 1px ${colors.rule}`,
                  transform: isSelected ? "scale(1.14)" : "scale(1)",
                  outlineColor: colors.accent,
                  scrollSnapAlign: "center",
                }}
              />
            );
          })}
        </div>
      </div>

      {swatches.length > 1 ? (
        <div
          ref={trackRef}
          role="slider"
          aria-label="מיקום ברשימת הצבעים"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(scrollProgress * 100)}
          onPointerDown={(event) => {
            event.preventDefault();
            setThumbDragging(true);
            handleTrackPointer(event.clientX);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!thumbDragging) return;
            handleTrackPointer(event.clientX);
          }}
          onPointerUp={(event) => {
            setThumbDragging(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => setThumbDragging(false)}
          style={{
            position: "relative",
            height: compact ? 5 : 6,
            marginInline: viewportPadInline,
            marginTop: 2,
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
              left: thumbLeftPx,
              width: thumbWidthPx,
              borderRadius: radius.full,
              background: `linear-gradient(90deg, ${colors.inkSubtle}, ${colors.inkMuted})`,
              boxShadow: thumbDragging
                ? "0 0 0 2px rgba(156,66,33,0.25)"
                : "0 1px 3px rgba(28,24,21,0.15)",
              transition: thumbDragging ? "none" : "left 140ms ease, width 140ms ease",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default ColorSwatchRail;
