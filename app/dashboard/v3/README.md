# /dashboard/v3 — Active

The current supervisor console. Dark-mode, Tailwind v4, shadcn-style
components copy-pasted in (no shadcn CLI dependency).

## Structure

```
v3/
├── layout.tsx            dark theme wrapper + Sidebar
├── page.tsx              /v3 — Leads board with 4 buckets
│                         (if ?lead=<sid> present → expanded view)
├── _components/          UI shared across v3 pages
│   ├── Sidebar.tsx
│   ├── LeadsBoard.tsx    bucket grid + cards + hover preview
│   ├── ExpandedLead.tsx  tabs (overview / chat / summary)
│   ├── ComingSoon.tsx
│   ├── buckets.ts        stage→bucket mapping
│   └── stage-meta.ts     stage labels + tones + timeAgoHe
├── drafts/               approval queue
│   ├── page.tsx
│   └── DraftQueueV3.tsx
├── leads/                /v3/leads → redirect to /v3
├── pipeline/             /v3/pipeline — kanban by 11 stages
│   ├── page.tsx
│   └── PipelineBoard.tsx
├── analytics/            /v3/analytics — KPIs + funnel + chart
│   ├── page.tsx
│   └── AnalyticsView.tsx
├── conversations/        /v3/conversations — WhatsApp-style chat
│   ├── page.tsx
│   └── _components/
│       ├── ConversationsLayout.tsx
│       ├── ChatThread.tsx       (bubbles)
│       ├── OrderSummary.tsx     (collapsible, inline-edit)
│       └── Composer.tsx         (send + LLM suggest + pause-bot ask)
└── settings/             /v3/settings — feature flags + bot_config
    ├── page.tsx
    └── SettingsForm.tsx
```

## Conventions

- Tailwind v4 with CSS-first `@theme` in `app/globals.css`.
- `lib/cn` (clsx + tailwind-merge) for class merging.
- Icons: `lucide-react`. Charts: `recharts`.
- Server components fetch via Drizzle directly; mutations through server
  actions in `app/actions/v2.ts` (the file name is historical — both versions
  share it).
- URL state is the source of truth for selection (`?lead=`). When a card is
  clicked the router pushes the param; the server re-renders.

## Coupling to backend

- `bot_drafts`, `messages`, `leads`, `lead_tags`, `bridge_events`, `bot_config`
  tables — declared in `drizzle/schema.ts`.
- New write endpoints (Retool-era artifact) live at `app/api/drafts/*` and
  `app/api/leads/[id]/override`. The v3 UI calls server actions instead; the
  REST endpoints stay around in case external tooling shows up.

## Migrations from v2 to v3 still open

- `instructions` doc lives at `/dashboard/v2/instructions`; equivalent v3 doc
  not yet written.
- v3 has no analog for `/dashboard/v2/stage/[stage]` deep-link — covered by
  the bucket filter chips on the Leads board.
- Bot prompt editing in Settings saves to `bot_config` but the bot still
  reads from hardcoded strings. Integration is pending.
- Pipeline drag-drop is not yet implemented; the toggle in Settings is the
  prep for it.
