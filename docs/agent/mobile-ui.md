# Mobile .mfit layer & widget UI

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Mobile layer — `.mfit` (READ BEFORE ADDING RESPONSIVE CSS)

### GHL widget is the canonical UI (permanent rule, 2026-09-17)

Eli works from the GHL Hub widget. Build every user-visible CRM feature under
`/widget` first. If a matching `/dashboard/v3` route remains for compatibility,
it must import the exact widget component and data loader; it must not own a
second implementation. GHL owns operational CRM fields (pipeline stage, status,
owner, contact details, tags and tasks); the Albadi DB mirrors those fields and
owns bot-event history and analytics aggregates. Test and smoke-check the GHL
route first and its dashboard alias second. Only diverge when Eli explicitly
requests a surface-specific behavior.

Eli works the widget from a **phone browser directly** (not the GHL app), so
every hub tab has to survive ~390px. The tree was built for a desktop iframe:
~95% inline `style={{}}`, and before 2026-08-14 there were **4 `@media` queries
across 90 UI files**.

**All mobile rules live in ONE block at the end of [app/globals.css](app/globals.css),
inside `@media (max-width: 767px)`.** That is deliberate: desktop is unchanged
*by construction*, because a rule that isn't in that block cannot have moved
anything. Verified — at 1440px the shell padding is still exactly
`26px 32px 40px`, `.lux-title` still `32px`, hub margin still `-12px`.

**⚠️ Scope with `.mfit`, NEVER `.gg-theme`.** `.gg-theme` looks like the widget
scope but [app/dashboard/v3/layout.tsx](app/dashboard/v3/layout.tsx) also carries
it, and `middleware.ts` rewrites `/` → `/dashboard/v3` — so a `.gg-theme`-scoped
rule silently restyles the dashboard too. `.mfit` is a marker class that means
"this is a widget screen" and nothing else. It is applied in three places, and
**two of the eleven tabs are NOT under the widget layout**, so they set it
themselves:
- [app/widget/layout.tsx](app/widget/layout.tsx) — covers 9 tabs
- [app/configurator/page.tsx](app/configurator/page.tsx) — מעצב 3D lives outside `app/widget/`
- [components/playground/PlaygroundView.tsx](components/playground/PlaygroundView.tsx) — has no theme class of its own

**The four opt-in hooks** (`!important` only ever lands on a class we invented,
so grepping the name gives the complete blast radius, forever):

| class | effect | when |
|---|---|---|
| `lux-stack-sm` | `grid-template-columns: 1fr` | a hard multi-column grid |
| `lux-scroll-x` | wrapper scrolls sideways | **flat** grids that would scramble if stacked |
| `lux-wrap-sm` | `flex-wrap: wrap` | a row that must stay one line on desktop |
| `lux-tap` | `min-height: 34px` | a small TEXT button (`הסר` was 21×18 and destructive) |
| `size-7` | 28px → 36px | icon buttons (36, not 44 — quote rows carry several) |

Don't replace `lux-tap` with a blanket `.mfit button { min-height }` — the inline
18px payment checkboxes are deliberately small and would stretch into tall thin
boxes (`min-height` beats an inline `height`).

**`flexShrink: 0` + no width cap = clipped, not wrapped.** `LuxTitle`'s `aside`
took its max-content width (a 4-tile KPI row is ~445px) and spilled off the
start edge even after the header wrapped. It carries `maxWidth: 100%` now. Watch
for the same shape anywhere a non-shrinking flex item holds a row of tiles.

**`grid-cols-N` / `1fr` tracks never overflow — they shrink.** Only grids with a
**fixed px track** actually push the page sideways. So a mechanical "add `md:`
everywhere" sweep is churn; fix the fixed-track ones and stack the rest only
where a cell becomes unreadable.

**Stacking is wrong for a flat grid.** [ClosedQuotesView.tsx](components/factory-flow/ClosedQuotesView.tsx)'s
planned↔actual table interleaves header cells with each `CostRow`'s four cells as
**siblings** — collapsing it to `1fr` yields 16 unlabelled rows. It uses
`lux-scroll-x`. Check whether children are flat before reaching for `lux-stack-sm`.

**The two bugs worth knowing:**
1. **iOS zooms the page on focus of any control under 16px** and never zooms
   back — and since tabs are in an iframe, it scales the *top* document, so the
   nav scrolls away with no way back. 163 controls were 11–14px. One rule fixes
   it; don't undo it.
2. **`100vh` ≠ the visible viewport on mobile Safari.** Use `dvh` — the hub
   shell, `LuxShell`, and every modal `max-h` are on `dvh` now.

**The layout padding and the hub's negative margin must stay in sync.** The hub
cancels the widget layout's padding with a negative margin; both are
`clamp(6px, 2vw, 12px)` now. Hardcoding one of them makes the page 4px wider
than the viewport on a phone.

**Verify with the probe, not the eye:** per tab, inside the iframe,
`document.documentElement.scrollWidth <= clientWidth + 1`, and
`[...d.querySelectorAll('input,select,textarea')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).length === 0`.
When listing overflowing elements, **skip anything inside a scrollable
ancestor** (`overflowX auto/scroll` && `scrollWidth > clientWidth`) — otherwise
a deliberately side-scrolling table reports as 28 breaks.

**How to check a DATA screen locally — you CAN (fixed 2026-08-31).** The old
advice here was "you can't, build fixtures instead", because `vercel env pull`
masks `DATABASE_URL` to `""` and this project's Vercel previews cannot build at
all (`DATABASE_URL` is Production-scoped). But `neonctl` is authed on this
machine, so the launch config can resolve the connection string **at launch
time** and nothing secret is written to disk:

```jsonc
// .claude/launch.json — ⚠️ gitignored (.gitignore:15 `.claude/*`), so it is
// per-machine. Recreate this entry if it is missing:
{
  "name": "albadi-crm-data-dev",
  "runtimeExecutable": "sh",
  "runtimeArgs": ["-c", "GHL_WIDGET_TOKEN= DATABASE_URL=\"$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)\" npm run dev -- -p 3002"],
  "port": 3002
}
```

Blank `GHL_WIDGET_TOKEN` takes `verifyWidgetToken`'s dev pass-through branch, so
widget routes open without a token in the URL. **This is the live production
database** — read freely, but anything that writes (a form submit, a delete
button) writes for real. Use `albadi-crm-widget-dev` (port 3001) for pure
layout work where the screen may render empty.

The fixture route is still the right tool when you need a state the real data
does not contain. Two gotchas if you go that way: an `_`-prefixed folder is a
**private** folder and won't route, and a fixture missing one numeric field
throws `undefined.toLocaleString` inside render, which React retries until the
renderer dies — that reads as "the page won't load", not as a bad fixture.

**Footgun while developing:** Turbopack serves a **stale CSS chunk** — edits to
globals.css silently don't appear, and restarting the dev server is not enough.
`rm -rf .next/dev .next/cache` and restart. Two rounds were lost to this.
