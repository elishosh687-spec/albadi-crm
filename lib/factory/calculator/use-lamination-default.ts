"use client";

import { useCallback, useEffect, useRef } from "react";
import { suggestsLamination } from "./lamination";

/**
 * Lamination that follows the colour count UNTIL a person touches it.
 *
 * Replaces the old snap-back effect, which re-ticked lamination on every render
 * where colours were 3+ — so turning it off was impossible, not just undone.
 *
 * - Reacts only to a CHANGE in colours, never on mount, so a prefilled or
 *   loaded spec keeps whatever it arrived with.
 * - Until the returned `markTouched` is called, a colour change sets lamination
 *   to the default for that count — in BOTH directions (4+ → on, below → off).
 * - After it is called, the person's choice is never overwritten again.
 *
 * One hook because the same pattern lives in four screens (both calculator
 * tabs, the sales calculator, the quote-request form); four copies is how the
 * old rule ended up with three different thresholds.
 */
export function useLaminationDefault(
  colors: number,
  setLamination: (on: boolean) => void,
): () => void {
  const touched = useRef(false);
  const prevColors = useRef(colors);

  useEffect(() => {
    if (prevColors.current === colors) return;
    prevColors.current = colors;
    if (!touched.current) setLamination(suggestsLamination(colors));
  }, [colors, setLamination]);

  return useCallback(() => {
    touched.current = true;
  }, []);
}
