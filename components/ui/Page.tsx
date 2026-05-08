import { colors, eyebrowStyle, fontStack, headingStyle, leading, size, space, weight } from "@/lib/ui/tokens";

interface PageProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Page({ eyebrow, title, description, actions }: PageProps) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: space.lg,
        paddingBottom: space.xl,
        marginBottom: space["2xl"],
        borderBottom: `1px solid ${colors.rule}`,
      }}
    >
      <div>
        {eyebrow && <p style={eyebrowStyle}>{eyebrow}</p>}
        <h1 style={{ ...headingStyle("h1"), marginTop: eyebrow ? space.sm : 0 }}>{title}</h1>
        {description && (
          <p
            style={{
              fontFamily: fontStack.body,
              fontSize: size.md,
              fontWeight: weight.regular,
              color: colors.inkMuted,
              lineHeight: leading.normal,
              marginTop: space.sm,
              marginBottom: 0,
              maxWidth: 640,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
    </header>
  );
}
