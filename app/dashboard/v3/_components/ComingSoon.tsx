import { Hammer } from "lucide-react";

export function ComingSoon({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1
          className="text-3xl font-medium tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
      </header>
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
        <Hammer className="mx-auto size-8 text-muted-foreground mb-3" />
        <div className="text-lg font-medium text-foreground">בקרוב</div>
        {hint && (
          <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
