import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

interface BadgeProps {
  tone?: Tone;
  children: React.ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  const tones: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceMuted, fg: colors.inkMuted },
    success: { bg: colors.successBg, fg: colors.success },
    warning: { bg: colors.warningBg, fg: colors.warning },
    danger: { bg: colors.dangerBg, fg: colors.danger },
    info: { bg: colors.infoBg, fg: colors.info },
    accent: { bg: colors.accentSoft, fg: colors.accent },
  };
  const t = tones[tone];

  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        fontFamily: fontStack.body,
        fontSize: size.xs,
        fontWeight: weight.medium,
        padding: `${space.xs / 1}px ${space.sm}px`,
        borderRadius: radius.sm,
        whiteSpace: "nowrap",
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const tones: Record<Tone, string> = {
    neutral: colors.inkSubtle,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
    accent: colors.accent,
  };
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: tones[tone],
        display: "inline-block",
      }}
    />
  );
}
