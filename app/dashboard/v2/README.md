# /dashboard/v2 — Legacy

Status: **fallback**. Active development happens in `../v3/`.

## Why it still exists

v2 was the working CRM until v3 shipped on 2026-05-13. It is kept untouched as
a safety net while Eli kicks the tires on v3. If anything regresses badly in
v3, every URL on `/dashboard/v2*` continues to work because v2 has its own
`layout.tsx` that injects its own chrome.

## Conventions

- Light theme via `lib/ui/tokens`. NO Tailwind, NO `cn` helper.
- Pages are inline-styled. Components live next to their pages or under
  `_components/` for things shared across v2 sub-routes.
- All mutations go through `app/actions/v2.ts` server actions.

## Files

- `layout.tsx` — wraps everything under `/dashboard/v2/*` in `<V2Chrome>`.
- `_components/V2Chrome.tsx` — navbar + 1200px max-width container.
- `page.tsx` — Inbox + Pipeline home (NeedsEli queue, stage cards).
- `NotesModal.tsx`, `NeedsEliCard.tsx` — co-located widgets for the home page.
- `instructions/page.tsx` — `/dashboard/v2/instructions` operator manual.
- `drafts/page.tsx` — `/dashboard/v2/drafts` approval queue.
- `lead/[sid]/` — per-lead detail.
- `stage/[stage]/` — per-stage list view.

## What NOT to do

- Do NOT add new features here. Add to `../v3/`.
- Do NOT import from `../v3/`. v2 must stay self-contained.
- Do NOT change v2 just to keep it in sync with v3 — they are intentionally
  divergent until v3 fully replaces v2.
