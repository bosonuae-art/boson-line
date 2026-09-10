# The Boson Line — 2026 NFL pick'em

A pick sheet for Bo and Dad, built from Pete Holland's 2026 NFL workbook.
Bo vs Dad vs Vegas, one point per correct call, same scoring as the spreadsheet.

**Live app:** https://claude.ai/code/artifact/49b2c07f-1e36-45d4-867a-e0721a76ef5e

## Sharing — why there's no shared database

The first cut used the artifact `db` capability so both players wrote to one live ledger. That turned out to
make the artifact **unshareable**: the share dialog greys out "Anyone with the link" with the reason
*"This Artifact stores shared data, so it can't be shared publicly."* A db artifact is organization-internal,
and on a personal account there is no way to add someone outside it.

So `db` was dropped. Picks now live in each device's `localStorage`, and the two sheets are reconciled with a
**pick code** — the whole season packed into ~78 characters (one base-3 digit per game, five to a byte,
base64url, prefixed `BL1B` for Bo or `BL1D` for Dad). Copy yours, text it over, paste theirs. The app also
accepts `#p=<code>` on the URL.

## What's here

| File | What it is |
|---|---|
| `index.html` | The built app. **Don't hand-edit it** — edit `template.html` and rebuild. |
| `template.html` | The real source, with `__SCHED__`, `__BYES__`, `__LIVE__`, `__SYNCED__` placeholders. |
| `tools/gen.py` | Reads `2026 NFL .xlsx` → `tools/data2026.json` (272 games, preseason lines, byes). Run once. |
| `tools/sync.py` | Pulls all 18 weeks from ESPN → `tools/live/w1..w18.json` (kickoffs, DraftKings lines, totals, moneylines, live scores, finals). |
| `tools/build.py` | Injects the data sets into `template.html` → `index.html`, and escapes every non-ASCII character inside the `<script>` block so the page can't mojibake. |
| `tools/logos.py` | Downloads all 32 club marks from ESPN (light + dark variants), scales to 48px and base64-encodes them into `tools/logos.json`. Run once. |
| `tools/accents.py` | Derives a theme-safe accent per club from its brand colors — keeps hue and saturation, moves lightness into a band that clears 3:1 contrast on both grounds. Without this, the Raiders and Steelers (`#000000`) vanish on the dark theme and the Saints (`#d3bc8d`) vanish on the light one. Writes back into `logos.json`. |
| `bo_code.txt` | Bo's 271 picks as a pick code, rescued from the old database before `db` was dropped. |

## Refreshing odds and scores

The ESPN snapshot is embedded in the page, so refreshing it means republishing:

```bash
cd tools && python sync.py && python build.py
```

…then republish `index.html` to the same artifact URL. Everyone open gets the new version automatically.

## Data notes

- All 272 games matched ESPN on abbreviation (only fix needed: ESPN's `WSH` → the sheet's `WAS`).
- 270 of 272 have a live DraftKings line. W12 `CAR@TB` has no preseason line in the workbook (renders as
  "no line"); W3 `MIN@TB` opened pick'em and renders as `PK`.
- **Vegas** as a competitor uses the *preseason* favorite from the workbook, locked for the season, so its
  record can't drift. The "Line" column is the current market and is what against-the-spread is judged on.
- Final scores arrive with the odds; hand entry is only an override, and is marked "by hand" in the app.
- Games lock at kickoff. Where a kickoff time is missing, they lock when the week ends.

## Design

The visual system follows `C:\Projects\portfolio-website\docs\DESIGN.md`: every neutral tinted toward the
canvas (never `#000`/`#fff`), hairline borders, sharp 2px corners, one accent held under ~10% of any view,
ambient motion that never performs, reduced-motion as a first-class state. Type is that system's three
families in the same three roles — Bricolage Grotesque (display), Public Sans (body), Martian Mono (the
"voice": eyebrows, column heads, codes and figures).

Club marks follow the portfolio's brand-icon rule — *real colored marks, never tinted silhouettes, never
wordmarks*. They ship as data URIs because the artifact CSP blocks every external image host; light and dark
variants both ship and CSS shows whichever suits the viewer's theme. Club color appears in exactly one place
where it carries data: the favored-games bar on the Teams tab.
