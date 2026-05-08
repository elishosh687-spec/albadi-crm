"use client";

import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  pendingText?: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size: sz = "md",
  pending = false,
  pendingText,
  fullWidth = false,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || pending;

  const sizeStyle: Record<Size, React.CSSProperties> = {
    sm: { padding: `${space.xs}px ${space.md}px`, fontSize: size.sm },
    md: { padding: `${space.sm}px ${space.lg}px`, fontSize: size.md },
    lg: { padding: `${space.md}px ${space.xl}px`, fontSize: size.lg },
  };

  const variantStyle: Record<Variant, React.CSSProperties> = {
    primary: {
      background: isDisabled ? colors.inkSubtle : colors.accent,
      color: colors.surface,
      border: `1px solid ${isDisabled ? colors.inkSubtle : colors.accent}`,
    },
    secondary: {
      background: colors.surface,
      color: colors.ink,
      border: `1px solid ${colors.rule}`,
    },
    ghost: {
      background: "transparent",
      color: colors.ink,
      border: "1px solid transparent",
    },
    danger: {
      background: isDisabled ? colors.inkSubtle : colors.danger,
      color: colors.surface,
      border: `1px solid ${isDisabled ? colors.inkSubtle : colors.danger}`,
    },
  };

  return (
    <button
      disabled={isDisabled}
      {...rest}
      style={{
        fontFamily: fontStack.body,
        fontWeight: weight.medium,
        borderRadius: radius.md,
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: "background 150ms, color 150ms, border-color 150ms, opacity 150ms",
        opacity: pending ? 0.7 : 1,
        width: fullWidth ? "100%" : undefined,
        textAlign: "center",
        textDecoration: "none",
        lineHeight: 1.2,
        ...sizeStyle[sz],
        ...variantStyle[variant],
        ...style,
      }}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
