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

## UI design rules — ui-ux-pro-max (permanent rule, 2026-09-18)

Eli's rule: **every UI change or addition** (new tab, restyle, new control,
new section) follows the `ui-ux-pro-max` skill
(`~/.claude/skills.cold/ui-ux-pro-max/SKILL.md`; Codex: `~/.codex/skills/ui-ux-pro-max`,
a symlink to the same folder). Four people use the hub, on desktop and phone,
so usability rules are not optional.

- **Style stays Silent Luxury.** The skill's `--design-system` generator
  suggests a blue/light "Data-Dense Dashboard" with Fira fonts for this product
  type — do NOT adopt it; its own `consistency` rule wins. Take its structure
  (KPIs first, status colours + text, sort, row hover), not its palette.
- Run the skill's searches for the area you touch
  (`python3 ~/.claude/skills.cold/ui-ux-pro-max/scripts/search.py "<q>" --domain ux|chart`).
- **Contrast:** secondary text ≥ 4.5:1 on the card surface. The original
  `--lux-muted #8a7f74` measures 4.1–4.4:1 → use `#a0958a` (5.5:1) for
  secondary text and `#958b80` as the faintest allowed text colour.
- **Touch:** every button/chip/tab/input ≥ 44px tall (supersedes the old 34px
  `lux-tap`). Small visuals (switches) get a 44px hit area.
- **Type:** nothing under 12px; body 15px desktop, 16px phone.
- Wrap long names (ad names) instead of ellipsis-truncating them.
- Funnels: ≤ 8 stages, group unmeasured stages as "לא נמדד" (never 0%),
  mark the biggest drop in colour **and** words, text summary for screen readers.
- Loading = skeleton, save = "שומר…" → "נשמר" (aria-live), inline validation
  on blur with the error under the field.
- Every tab / sub-tab has its own URL (query or hash) so a colleague can be sent
  straight to it.
- Transitions 150–220ms; respect `prefers-reduced-motion`.
- Before delivery: run the skill's Pre-Delivery Checklist, probe 375px +
  landscape, and measure contrast/tap/font sizes in the browser — don't eyeball.

### The `.ux-*` layer (built 2026-09-18 — ads, analytics, settings)

- CSS lives in `app/globals.css` (block "`.ux-*` — the ui-ux-pro-max layer";
  phone rules inside the first `@media (max-width: 767px)` block). A tab opts in
  with `<LuxShell className="ux">`. Blast radius = `grep ux-`.
- Pieces: `ux-chip`/`ux-btn` (44px), `ux-tabs` (underline tabs, `aria-current`
  / `aria-selected`), `ux-todo` ("לטיפול עכשיו"), `ux-kpis`, `ux-list`+`ux-row`
  (collapsed `<details>` rows; phone shows `.mline`), `ux-pill[data-tone]`,
  `ux-panel`, `ux-alerts`, `ux-funnel`/`ux-fs`, `ux-table`, `ux-hbars`,
  `ux-set`/`ux-side`/`ux-savebar` (settings), `ux-skel`, `ux-sr`, `ux-hit`
  (44px hit area around a small glyph).
- `.ux-set` gives every control in the (older) settings components a 44px floor.
- **Deep links:** the hub forwards `?view=` and `?section=` to the tab iframe
  (`HubShell` `deepLink`); a tab mirrors its sub-view back with `syncHubUrl`
  / `<HubUrlSync>` (`lib/widget/hub-link.ts`). A link to ANOTHER tab uses
  `hubHref(...)` + `target="_parent"` — a plain link inside the iframe would
  load a hub inside the hub.
- Settings groups: `SETTINGS_GROUPS` in `components/settings/SettingsView.tsx`
  (`price` · `ship` · `team` · `calls` · `templates` · `ads` (Meta) · `google-ads`). Groups stay
  mounted (hidden) so a half-edited group keeps its draft; one sticky save bar
  lists what changed; `beforeunload` guards a dirty draft.
- Root layout's rust `a {}` colour is scoped to the light pages
  (`a:where(:not(.lux-theme *, .calc-lux *))`): unlayered, it used to beat every
  Tailwind text colour on a link and read 2.45:1 on the dark hub.
- Lux red is `--color-destructive: #ec8b8b` (the default read 4.48:1).
- Probe used for verification: small text (<12px), tap targets (<44px, except
  checkboxes and `.ux-hit`), contrast (<4.5:1, colours normalised via canvas),
  overflow — run on every view at 1280, 375 and 812×375.

### Hub tab bar + שיחות list (2026-09-18)

- Tab bar (`components/hub/HubShell.tsx`): desktop tabs 44px, `aria-current`;
  the fake "חיפוש ⌘K" box is gone. Phone (<768px) hides the top strip and shows
  `.hub-bottom`: `HUB_PRIMARY_TAB_IDS` (שיחות · הצעות מחיר · עסקאות —
  Eli's pick; אישורים was deleted the same day) + "עוד" (`<details>` sheet with the rest).
- שיחות default screen is `components/inbox/ConversationList.tsx` (the old
  "צריכים אותך עכשיו" CockpitView is deleted — its rows only showed "—"):
  WhatsApp-style rows (who wrote the last line + text + time ago), customers
  waiting for our reply ≤ 7 days on top (`WAITING_MAX_DAYS`, oldest first),
  search, 40 rows per page; tap → `ConversationThread` (below).
  Formatting in `lib/inbox/list-format.ts` (media placeholders like
  `[imageMessage]` → "תמונה"; initials via `Array.from` — indexing split a
  non-BMP styled name and broke hydration). `renderedAt` comes from the server
  so "לפני X" matches on hydration.

### מחיר מתחרים (2026-09-18)

`SizeComparisonTable` keeps Eli's "pick a size, see every competitor" model
(a card-per-comparison layout was rejected earlier as unreadable) but: KPIs
now come from the LIVE our-side price (`lib/competitors/compare.ts` —
`gapVerdict`/`summarize`; the old "זולים יותר" used the hand-typed `ourPrice`
and showed "—"), one filter row, the profit scenario folded in a `<details>`,
6 columns with the verdict in words ("אנחנו זולים ב־₪3,950 (32%)"),
plate/shipping/lead time behind "פרטים", rows grouped by supplier, and the
table turns into cards under 768px (`.competitor-table` in globals.css).

### Compliance pass over every tab (2026-09-18)

- Probe (small text / taps / contrast / overflow) run on every hub tab at
  375px, 812×375 and 1280px: all clean except the planned-vs-actual cost table
  on עסקאות (a deliberate `.lux-scroll-x` region) and the 3D designer (own
  light theme, left as-is by design).
- `.ux-floor` on FactoryFlowView, ClosedQuotesView, ConsolidationView,
  ColorCatalogScreen, PlaygroundView and CalculatorView: every control ≥44px,
  `a.size-7` icon links too.
- Lux base: `.lux-overline` / `.lux-label` / `.lux-stat-label` 12px (were 10),
  `.mfit .lux-tap` 44px (was 34), `.lux-range` = 44px input with a 6px track
  pseudo-element (look unchanged), `.mfit .lux-stack-sm` uses
  `minmax(0,1fr)` + `min-width:0` children (a plain `1fr` grew to 557px on the
  shipping list). `.mfit .calc-lux select { width:100% }` — a select is as wide
  as its longest option and pushed the calculator 130px off a phone.
- Font sweep in factory-flow / shipping / playground / colors / calculator:
  inline and Tailwind sizes under 12px raised; `#8a7f74` → `var(--lux-muted)`.
  Playground `faint` #6b645c → #958b80.

### Structural pass over the remaining tabs (2026-09-18, second session)

- **LuxShell is not a scroll container any more** (`overflow-x: clip`, was
  `overflow-y: auto` + `min-height`): the shell grew with its content, the
  window scrolled, and every `position: sticky` child (calculator summary,
  shipping rail, settings save bar) was pinned to a box that never scrolled.
- **הצעות מחיר** (`QuotesHistoryView` / `FactoryFlowView`): "הצעה חדשה" button
  opens the lead picker (no second search box on top); reminder panels
  (`AlertShell` — המפעל ענה / ממתינות לתמחור / טיוטות) use lucide icons and
  labelled 44px actions (`Act` = `.ux-btn.sm` + tone `primary|go|warn|danger`);
  one card per customer (`.qh-g`, 30 per page) with the customer-wide actions
  inside; recycle bin + Feishu import folded at the bottom. Statuses in words:
  טיוטה · ממתין למפעל · המפעל ענה · סופי.
- **מחשבון**: layout is Eli's approved mockup — do not restructure. Fixed:
  summary "נטו" showed the GROSS profit; boss table used rounded-per-unit
  shipping × qty for the commission base (≠ DetailedBreakdown) — all three use
  `r2(shippingPerUnitIls × qty)` now. "בחר לקוח" row in the summary (the send
  buttons were disabled with no hint). Read-only commission copy removed.
- **צירוף משלוחים**: search, "עסקאות שנסגרו" first, date + quote no. per row,
  stage via `stageLabel`, real checkbox; phone pins the saving to the bottom
  only while something is ticked. Loader skips soft-deleted quotes.
- **צבעים**: search by name / hex / factory code, `ux-tabs`, `?view=factories`.
- **מגרש בדיקות**: lucide icons (no emoji), 44px tablist, `?view=`
  (`?tab=` still read), initial tab from the server (hydration). Bot map /
  settings faint text → #958b80.
- **שיחה מלאה**: `components/inbox/ConversationThread.tsx` replaced InboxView
  (deleted). Chat layout (`.ux-thread`: only `.th-body` scrolls), bot state in
  words + action, labelled tool row, day separators, sender + time per bubble,
  16px composer. `LeadAnalysisInline` restyled (`.la-*`).
- Probe after all of it: 11 tabs × 375 / 1280 clean except the known false
  positive (dark text on a champagne button reads as 1.09:1 against the page).

