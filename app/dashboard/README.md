# /dashboard

The CRM lives entirely under `v3/`. The bare `/dashboard` route redirects
there. v2 was retired on 2026-05-14; if you are looking for it, see the
final commit before deletion in git history.

```
app/dashboard/
├── layout.tsx          passthrough — does NOT inject chrome
├── page.tsx            redirects to /dashboard/v3
├── README.md           this file
└── v3/                 the supervisor console (dark theme, Tailwind v4)
    ├── README.md
    ├── layout.tsx      adds `.dark` class + sidebar nav
    ├── _components/
    ├── page.tsx        /dashboard/v3   (Leads board OR expanded view if ?lead=)
    ├── drafts/         /dashboard/v3/drafts
    ├── leads/          redirect to /dashboard/v3
    ├── pipeline/       /dashboard/v3/pipeline (kanban by 11 stages)
    ├── analytics/      /dashboard/v3/analytics
    ├── conversations/  /dashboard/v3/conversations (WhatsApp-style chat)
    └── settings/       /dashboard/v3/settings
```

## Conventions

- Tailwind v4 with CSS-first `@theme` in `app/globals.css`.
- `lib/cn` (clsx + tailwind-merge) for class merging.
- Icons: `lucide-react`. Charts: `recharts`.
- Server components fetch via Drizzle; mutations through server actions
  in `app/actions/v2.ts` (filename is historical; keep until next refactor).
