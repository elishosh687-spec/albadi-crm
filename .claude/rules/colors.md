---
paths:
  - "lib/colors/**"
  - "components/colors/**"
  - "app/widget/colors/**"
---

# Factory colour catalogue
- `lib/colors/factory-catalog.ts` is a client-safe const module (no env, no server imports), not a DB table, no edit screen; regenerate from `content/albadi/color-catalogs/out/{MASTER,FACTORY3_CLEAN}.json`.
- Never merge with `lib/constants/bagColors.ts` — `BAG_COLORS` drives the 3D configurator render; this module is what you order from a factory.
- Codes do NOT translate between factories (`R08` is red at one mill, magenta at another): always show the per-factory code, never one code.
- Catalogues are fabric mills; `MANDY` has two (`MATERIAL COLOR 3` + `4`).
- `whenToUse`: `CHEN` = every bag type; `WEIWEI` = hand-sewn + heat-press flat, never heat-press 3D; `MANDY` = heat-press 3D only.
- The catalogue = the 14 shades found at all three factories; `CHEN`'s 32 shades are the one palette that works for any bag.
- Catalogue names are contacts, the quotes sheet (col S) records firms: `MANDY`=浙江华庆塑业有限公司, `WEIWEI`=温州亚森制袋, `CHEN`=浙江鼎驰新材料科技有限公司. UI leads with the contact name.
- Shades were measured from photos: keep the screen saying it is for a shortlist, not a customer commitment.

Full detail: `docs/agent/colors.md` — read it before non-trivial changes here.
