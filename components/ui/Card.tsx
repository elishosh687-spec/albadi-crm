import { colors, eyebrowStyle, headingStyle, space } from "@/lib/ui/tokens";

type Variant = "default" | "bordered" | "flush";

interface CardProps {
  title?: string;
  eyebrow?: string;
  variant?: Variant;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function Card({ title, eyebrow, variant = "default", children, actions }: CardProps) {
  const baseStyle: React.CSSProperties = {
    background: colors.surface,
    marginBottom: space["2xl"],
  };

  const variantStyle: Record<Variant, React.CSSProperties> = {
    default: {
      borderTop: `1px solid ${colors.rule}`,
      paddingTop: space.xl,
    },
    bordered: {
      border: `1px solid ${colors.rule}`,
      borderRadius: 8,
      padding: space.xl,
    },
    flush: {
      paddingTop: space.lg,
    },
  };

  return (
    <section style={{ ...baseStyle, ...variantStyle[variant] }}>
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: space.md,
            marginBottom: space.lg,
          }}
        >
          <div>
            {eyebrow && <p style={eyebrowStyle}>{eyebrow}</p>}
            {title && <h2 style={{ ...headingStyle("h2"), marginTop: eyebrow ? space.xs : 0 }}>{title}</h2>}
          </div>
          {actions && <div>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
