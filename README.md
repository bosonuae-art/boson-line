# The Boson Line — 2026 NFL pick'em

A pick sheet for Bo and Dad, built from Pete Holland's 2026 NFL workbook.
Bo vs Dad vs Vegas, one point per correct call, same scoring as the spreadsheet.

**Site:** https://bosonuae-art.github.io/boson-line/
**Artifact (older, private):** https://claude.ai/code/artifact/49b2c07f-1e36-45d4-867a-e0721a76ef5e

## Two builds, one set of data

| | `docs/` — GitHub Pages | `index.html` — claude.ai artifact |
|---|---|---|
| Shareable | Any link | Only inside the owner's org |
| Odds & scores | Fetched live from ESPN in the browser | Baked in; needs a republish to refresh |
| Club marks | Loaded from ESPN's CDN | Embedded as data URIs (~260 KB) |
| Shared picks | Firestore, live between both phones | None — pick codes only |

The artifact came first and is kept because it still works. The Pages site exists because
**the artifact sandbox blocks every network call** — no `fetch`, no external images — which is
also why a `db`-backed artifact can't be link-shared at all. A plain static page has neither limit.

## Finishing the Firestore setup

Picks sync through Firestore when `docs/config.js` names a project. Until then the site runs on
`localStorage` and the season pick-code, and the status pill in the header reads *On this device*.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. **Build → Firestore Database → Create database → production mode**
3. **Build → Authentication → Sign-in method → enable Anonymous**
4. **⚙ Project settings → General → Your apps → Web (`</>`)** → register → copy `firebaseConfig`
5. Paste it into `docs/config.js`, replacing `export const firebaseConfig = null;`
6. **Firestore → Rules** → paste `firestore.rules` from this repo → Publish
7. Commit and push; Pages redeploys in about a minute

The config is safe to commit — it identifies the project, it does not grant access. `firestore.rules`
is what decides who may read and write. See the comments in that file for how to tighten it from
"anyone signed in anonymously" to two named accounts.

Data model: `seasons/2026/weeks/w1` … `w18`, each `{ picks: {AWAY@HOME: {bo, dad}}, results: {...}, updatedAt }`.
On first connect, if the shared sheet is empty and the device is carrying a season, it pushes it up once.

## What's here

| File | What it is |
|---|---|
| `docs/index.html` | The Pages site. |
| `docs/assets/app.js` | The whole app: schedule, picks, scoring, ESPN fetching, rendering. |
| `docs/assets/store.js` | Firestore bridge. Degrades to local-only if no project is configured. |
| `docs/assets/data.js` | Generated. Schedule, byes, club accents, logo slugs, and a seed ESPN snapshot for first paint. |
| `docs/assets/styles.css` | Shared stylesheet (also the source for the artifact build's inline CSS). |
| `docs/config.js` | Firebase config. Yours to fill in. |
| `firestore.rules` | Paste into the Firebase console. |
| `template.html` / `index.html` | Artifact source and build. Edit the template, never `index.html`. |
| `bo_code.txt` | Bo's 271 picks as a pick code, rescued from the artifact database. |

### tools/

| Script | Run when |
|---|---|
| `gen.py` | Once. Reads `2026 NFL .xlsx` → `data2026.json` (272 games, preseason lines, byes). |
| `logos.py` | Once. Downloads 32 club marks (light + dark), scales and base64-encodes → `logos.json`. |
| `accents.py` | Once, after `logos.py`. Derives a theme-safe accent per club. |
| `sync.py` | Before an artifact republish. Pulls all 18 weeks from ESPN → `live/`. |
| `build_site.py` | After `sync.py` or a schedule change → `docs/assets/data.js`. |
| `build.py` | After `sync.py` → `index.html` for the artifact. |

`accents.py` exists because raw brand hex doesn't survive both themes: the Raiders and Steelers are
`#000000` and vanish on the dark ground, the Saints are `#d3bc8d` and vanish on the light one. It keeps
each club's hue and saturation and moves only lightness into a band that clears 3:1 contrast on both.
All 32 pass.

## Data notes

- All 272 games matched ESPN on abbreviation (only fix needed: ESPN's `WSH` → the sheet's `WAS`).
- 270 of 272 have a live DraftKings line. W12 `CAR@TB` has no preseason line in the workbook (renders as
  "no line"); W3 `MIN@TB` opened pick'em and renders as `PK`.
- **Vegas** as a competitor uses the *preseason* favorite from the workbook, locked for the season, so its
  record can't drift. The "Line" column is the current market and is what against-the-spread is judged on.
- Final scores arrive with the odds; hand entry is only an override, and is marked "by hand" in the app.
- Games lock at kickoff. Where a kickoff time is missing, they lock when the week ends.
- The Pages build refetches the viewed week every 30s while a game in it is live, every 10 minutes
  otherwise, and whenever the tab regains focus.

## Design

The visual system follows `C:\Projects\portfolio-website\docs\DESIGN.md`: every neutral tinted toward the
canvas (never `#000`/`#fff`), hairline borders, sharp 2px corners, one accent held under ~10% of any view,
ambient motion that never performs, reduced-motion as a first-class state. Type is that system's three
families in the same three roles — Bricolage Grotesque (display), Public Sans (body), Martian Mono (the
"voice": eyebrows, column heads, codes and figures).

Club marks follow the portfolio's brand-icon rule — *real colored marks, never tinted silhouettes, never
wordmarks*. Light and dark variants both ship and CSS shows whichever suits the viewer's theme. Club color
appears in exactly one place where it carries data: the favored-games bar on the Teams tab.
