# Factory colour catalogue

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## "צבעים" tab — the factory colour catalogue (built 2026-08-25)

Hub tab `colors` ([app/widget/colors](app/widget/colors/page.tsx) →
[ColorCatalogScreen.tsx](components/colors/ColorCatalogScreen.tsx)). Answers one
question: **which colour can we promise a customer before we know which factory
gets the order.**

Data: [lib/colors/factory-catalog.ts](lib/colors/factory-catalog.ts) — a
client-safe const module (no env, no server imports), **not** a DB table and
deliberately with no edit screen; the source PDFs change about once a year, so
changing a shade means editing a line. Regenerate from
`content/albadi/color-catalogs/out/{MASTER,FACTORY3_CLEAN}.json`, which sit next
to the four source PDFs.

⚠️ **`lib/constants/bagColors.ts` is a different thing** — `BAG_COLORS` drives
the 3D configurator's render. This module is what you *order from a factory*.
Don't merge them.

**Where the numbers came from.** The four `MATERIAL COLOR n` PDFs in the Feishu
folder `RSvLfcR4ull7BudymWQcWPfYnpg` are catalogues of **fabric mills**, not of
the bag factories — the file *names* carry the factory (WEIWEI / CHEN / MANDY),
and MANDY alone offers two mills (`MATERIAL COLOR 3` + `4`). Each of the 168
shades was sampled from a large fabric area beside its label, white-balance
corrected against the paper in the same photo (PINSEN was shot under much warmer
light — without the correction it skews orange), then compared with CIEDE2000.
14 shades exist at all three factories; those are the catalogue.

**Codes do NOT translate between factories.** `R08` at one mill is a bright red,
at another a magenta. Any surface that shows a colour must show the per-factory
code, never one code.

**Which factory serves which bag** — from the Feishu sheet *Classification of
non-woven bag material selection* (`RFd0stnYfh6H2BtFHZZc1cD2nme`, also tab
`MSlBqQ` of the quotes workbook). This is the `whenToUse` bubble on each factory:

| Factory | Catalogue | When |
|---|---|---|
| `CHEN` | MATERIAL COLOR 2 | **every bag type** — the only one that covers the whole matrix |
| `WEIWEI` | MATERIAL COLOR 1 | hand-sewn (flat + gusseted) and heat-press flat. **Never heat-press 3D** |
| `MANDY` (浙江华庆) | MATERIAL COLOR 3 + 4 | **heat-press 3D only** |

So the four mills are never all available at once, and `CHEN`'s 32 shades are
the one palette that works for any bag. Quote share for context (column S of the
quotes tab, 62 quotes). **The catalogue names are the CONTACTS, the sheet
records the FIRMS** — no sheet maps between them; Simon confirmed it by hand on
2026-08-27:

| Catalogue name | Company (column S) | Share of quotes |
|---|---|---|
| `MANDY` | 浙江华庆塑业有限公司 | 37% (23) |
| `WEIWEI` | 温州亚森制袋 | 26% (16) |
| `CHEN` | 浙江鼎驰新材料科技有限公司 | 23% (14) |

The remaining ~14% is eight one-off suppliers. Eli works by the contact name, so
that is what the UI leads with; the company name is the secondary line.
Worth noticing: `CHEN` is the only fabric that fits every bag type, yet it takes
the *smallest* share of the big three.

**Measured from photos, not a spectrophotometer.** Good enough to build the
shortlist, not to commit to a customer — the screen says so, keep it that way.
Near-whites and very dark shades are the least reliable (white fabric shot in
shade measures grey).
