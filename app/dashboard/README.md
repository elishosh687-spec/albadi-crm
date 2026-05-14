# /dashboard

Two parallel CRM UIs share this folder. They are fully isolated — neither inherits
chrome, styles, or components from the other. The root `layout.tsx` is a
passthrough so each subtree owns its presentation.

```
app/dashboard/
├── layout.tsx          passthrough — does NOT inject chrome
├── page.tsx            redirects to /dashboard/v3 (v3 is the active default)
├── README.md           this file
│
├── v2/                 LEGACY light-theme dashboard (kept as fallback)
│   ├── README.md
│   ├── layout.tsx      wraps every v2 page in <V2Chrome>
│   ├── _components/
│   │   └── V2Chrome.tsx     navbar + 1200px container
│   ├── page.tsx        /dashboard/v2  (Inbox + Pipeline home)
│   ├── instructions/   /dashboard/v2/instructions
│   ├── drafts/         /dashboard/v2/drafts
│   ├── lead/[sid]/
│   ├── stage/[stage]/
│   ├── NotesModal.tsx
│   └── NeedsEliCard.tsx
│
└── v3/                 ACTIVE dark-theme supervisor console (default)
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

## Isolation rules

- v2 must NEVER import from v3 and vice versa.
- v2 keeps inline styles + `lib/ui/tokens`. v3 uses Tailwind + `lib/cn`.
- Both share `app/actions/v2.ts` (server actions) and `lib/drafts`, `lib/bridge`.
- Tailwind v4 lives in `app/globals.css` and applies to v3 only via the `.dark`
  scope its layout adds.
- Database schema in `drizzle/schema.ts` is shared — neither version owns it.

## Removing v2

When v3 has been stable for >7 consecutive days and Eli has not opened v2:

1. `git rm -r app/dashboard/v2`
2. Update `V2Chrome`-style links anywhere they remain (search the codebase
   for `/dashboard/v2`).
3. Drop the `V2Chrome` references from instructions if it lives on as its own
   page somewhere else.
4. Squash-merge under a single commit `chore: remove legacy v2 dashboard`.

Until then, treat v2 as a read-only fallback. Bug fixes go in v3.
