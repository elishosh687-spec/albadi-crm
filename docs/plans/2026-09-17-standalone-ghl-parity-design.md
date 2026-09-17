# Standalone Site and GHL Hub Parity

**Date:** 2026-09-17  
**Status:** Approved by Eli

## Goal

Make the deployed standalone site a safe fallback for leaving GHL while keeping
the GHL Hub widget as the canonical user interface. The standalone site and the
GHL widget must render the same shell, tabs, components, data, and behavior.
There must not be a separately maintained dashboard UI.

## Product behavior

- `https://albadi-crm.vercel.app/` is the standalone entry point.
- An unauthenticated visitor is sent to the existing password login.
- After login, `/` renders the same Hub shell and the same tabs used inside GHL.
- `/widget/hub?widget_token=...` continues to be the GHL Custom Menu entry point.
- `/dashboard` and `/dashboard/v3` become compatibility redirects to `/`.
- Old deep dashboard links redirect to their canonical Hub tab where a mapping
  exists. No new feature may be implemented in a dashboard-only component.

## One implementation, two authentication contexts

The Hub shell and its tab registry will be extracted from the GHL page into a
shared server component. Both entry points call that component:

1. **GHL context:** authenticate with `GHL_WIDGET_TOKEN`; pass that token to
   iframe pages and requests as today.
2. **Standalone context:** authenticate with the existing `albadi_auth`
   HTTP-only cookie; iframe pages and APIs accept the cookie without requiring
   a widget token.

The standalone browser URL will not contain `GHL_WIDGET_TOKEN`. The admin
cookie remains HTTP-only, secure in production, same-site, and scoped to `/`.
The token and cookie are alternative credentials; accepting the cookie must not
weaken the GHL token check for external iframe traffic.

## Routing and ownership

- `/` is protected by middleware and renders the shared Hub in standalone mode.
- `/widget/hub` stays middleware-public and performs its own token check.
- Widget page routes and `/api/widget/*` handlers accept either a valid widget
  token or the valid admin cookie through shared authentication helpers.
- `/api/factory/*` keeps its existing middleware protection and widget-token
  backdoor. Standalone iframe requests use the admin cookie naturally.
- GHL remains the source of truth for operational CRM fields. The Albadi DB
  remains the mirror for those fields and the owner of bot history and analytics.

## Legacy dashboard treatment

The old dashboard stops being a user-facing product immediately. Its public
routes redirect to `/`, so Eli cannot accidentally work in a divergent UI.
Legacy implementation files may remain temporarily as unreachable rollback
material during verification. They can be deleted in a separate cleanup after
production parity is confirmed; removal is not required to establish one source
of truth.

## Error handling and security

- Invalid GHL tokens retain the existing Hebrew unauthorized state.
- Expired or missing standalone authentication redirects to `/login`.
- Login returns to the requested local route only; external redirect targets
  are never accepted.
- All iframe navigation preserves the active tab and optional lead `sid`.
- No credential is logged, rendered as text, or placed in the standalone URL.

## Verification

1. Unit tests cover widget-token, admin-cookie, missing-credential, and invalid-
   credential cases in the shared auth helpers.
2. Architecture tests ensure `/` and `/widget/hub` use the same Hub component
   and dashboard routes do not own independent UI.
3. Route-gate integration tests continue to classify and reject unauthenticated
   widget API requests.
4. Typecheck, unit tests, targeted integration tests, and production build pass.
5. Local smoke checks cover every Hub tab in standalone and GHL modes, including
   mobile width and preservation of active tab and `sid`.
6. After deployment, smoke-check the production root, login flow, GHL Hub URL,
   and representative read/write tabs before reporting completion.

## Rollback

The change is reversible by restoring the previous root rewrite and dashboard
redirects. Because the shared Hub does not change data ownership or database
schema, rollback requires no data migration.
