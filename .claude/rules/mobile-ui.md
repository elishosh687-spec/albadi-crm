---
paths:
  - "app/globals.css"
  - "app/widget/**"
  - "app/configurator/**"
  - "components/**"
---

# Mobile `.mfit` layer & widget UI
- Build user-visible features under `/widget` first; a `/dashboard/v3` alias must import the exact widget component and loader, never a second implementation.
- All mobile CSS lives in ONE `@media (max-width: 767px)` block at the end of `app/globals.css` — desktop is unchanged by construction.
- Scope with `.mfit`, NEVER `.gg-theme` (also on `app/dashboard/v3/layout.tsx`). `.mfit` is set in `app/widget/layout.tsx`, `app/configurator/page.tsx`, `components/playground/PlaygroundView.tsx`.
- Opt-in hooks: `lux-stack-sm` (1fr), `lux-scroll-x` (flat grids), `lux-wrap-sm`, `lux-tap` (min-height 34px text buttons), `size-7` (→36px icons). `!important` only on these invented classes.
- No blanket `.mfit button { min-height }` — it stretches the inline 18px payment checkboxes.
- Don't stack flat grids (siblings interleave, e.g. `ClosedQuotesView.tsx`) — use `lux-scroll-x`. Only fixed-px grid tracks overflow; skip blanket `md:` sweeps.
- `flexShrink: 0` without a width cap clips instead of wrapping; cap with `maxWidth: 100%`.
- Controls under 16px make iOS zoom the top document permanently — don't undo the 16px rule. Use `dvh`, not `100vh`.
- Layout padding and hub negative margin are both `clamp(6px, 2vw, 12px)` — keep in sync.
- Verify per tab with a probe (`scrollWidth <= clientWidth + 1`, zero controls <16px), skipping scrollable ancestors.
- `albadi-crm-data-dev` (port 3002) runs on the LIVE production DB — writes are real.
- Stale CSS from Turbopack: `rm -rf .next/dev .next/cache` and restart. `_`-prefixed folders don't route.

Full detail: `docs/agent/mobile-ui.md` — read it before non-trivial changes here.
