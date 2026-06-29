/**
 * LuxCTA — the Silent-Luxury action button in its four mockup variants:
 *   champagne (default primary: send/save/approve)
 *   navy      (the calculator's "send on WhatsApp")
 *   success   (green: WhatsApp / confirm)
 *   ghost     (line-only secondary)
 * Presentation-only thin wrapper over the .lux-cta-* classes in globals.css.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "champagne" | "navy" | "success" | "ghost";

const CLASS: Record<Variant, string> = {
  champagne: "lux-cta-champagne",
  navy: "lux-cta-primary",
  success: "lux-cta-success",
  ghost: "lux-cta-ghost",
};

export interface LuxCTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  /** stretch to full width */
  block?: boolean;
}

export default function LuxCTA({
  variant = "champagne",
  block,
  className = "",
  children,
  style,
  ...rest
}: LuxCTAProps) {
  return (
    <button
      {...rest}
      className={`${CLASS[variant]} ${className}`}
      style={{ ...(block ? { width: "100%" } : null), ...style }}
    >
      {children}
    </button>
  );
}
