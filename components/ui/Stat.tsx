import { colors, eyebrowStyle, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";

interface StatProps {
  label: string;
  value: string | number;
  hint?: string;
}

export function Stat({ label, value, hint }: StatProps) {
  return (
    <div style={{ minWidth: 120 }}>
      <p style={eyebrowStyle}>{label}</p>
      <p
        style={{
          fontFamily: fontStack.display,
          fontSize: size["2xl"],
          fontWeight: weight.medium,
          color: colors.ink,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
          margin: 0,
          marginTop: space.xs,
          lineHeight: leading.tight,
        }}
      >
        {value}
      </p>
      {hint && (
        <p
          style={{
            fontFamily: fontStack.body,
            fontSize: size.xs,
            color: colors.inkSubtle,
            margin: 0,
            marginTop: space.xs,
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: space["2xl"],
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}
