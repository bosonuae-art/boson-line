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

## The shared ledger

Picks sync live through Firestore. Project **`boson-line`**, data at
`seasons/2026/weeks/w1` … `w18`, each `{ picks: {AWAY@HOME: {bo, dad}}, results: {...}, updatedAt }`.
The header pill reads *Shared sheet* when it's connected and *On this device* when it isn't; the app is
fully usable either way, and the season pick-code still works as a backup or for moving to a new phone.

**There is no sign-in.** Anonymous auth was the obvious thing to require, but it is not a real gate —
anyone can mint an anonymous token in one call — and enabling it meant turning on Identity Platform, a
separate paid product, for no security gain. `firestore.rules` carries the restriction instead: a caller
can only touch those 18 documents, can only store the three fields the app writes, and is refused
everywhere else in the project. Verified against the live project:

| Request | Result |
|---|---|
| write a valid week (`w2`, `picks`) | accepted |
| write a bogus week id (`w99`) | rejected |
| write an unknown field | rejected |
| write another collection | rejected |
| write another season (`2027`) | rejected |

The practical protection for a family sheet is that the URL is not advertised. To lock it down properly:
enable Google sign-in in the Firebase console, gate the rules on the two account IDs (there's a commented
example in `firestore.rules`), and have `store.js` sign in before it reads. The API key in `docs/config.js`
is a Firebase web key and is meant to ship in client code; it can be narrowed further with an HTTP-referrer
restriction in the Cloud console under APIs & Services → Credentials.

## Managing Firebase from here

The project was set up by hand through the console, which was tedious and left `firestore.rules` in this
repo and the rules that are actually live free to drift apart. `firebase-tools` closes that gap:

```bash
firebase login                              # one-time, opens a browser
firebase deploy --only firestore:rules      # publish firestore.rules to the live project
```

`.firebaserc` pins the default project to `boson-line` and `firebase.json` points at `firestore.rules`, so
that deploy is all it takes. **`firestore.rules` here is the source of truth** — change it in the repo and
deploy, never edit rules in the console.

`.mcp.json` registers Firebase's official MCP server for this project, so Claude Code can drive the same
operations as typed tools. It authenticates with whatever `firebase login` established, so there are no
keys in the config. Verified working against the installed CLI (firebase-tools 15.30.0, MCP server 0.3.0,
68 tools):

| Step | Tool |
|---|---|
| Create a project | `firebase_create_project` |
| Create the Firestore database | `firestore_create_database` |
| Register a web app | `firebase_create_app` |
| Fetch the web SDK config | `firebase_get_sdk_config` |
| Read / validate / deploy rules | `firebase_get_security_rules`, `firebase_validate_security_rules`, `firebase_deploy` |
| Read and write picks | `firestore_get_document`, `firestore_query_collection`, `firestore_update_document` |

**What it cannot do: enable an authentication sign-in provider.** The whole `auth_` group is
`auth_get_users`, `auth_update_user`, `auth_set_sms_region_policy` — nothing that turns on anonymous or
Google sign-in. That is console-only, it is the exact step that blocked the original setup, and it is why
this app ended up with no sign-in at all. Accepting the Firebase terms of service is likewise console-only.

Everything else about that first setup — the project, the database, the app registration, the rules — would
have been scriptable.

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

## Phone layout

Checked at 390x844 and 360x780 by framing the site in same-origin iframes at those widths (media queries
evaluate against the frame's viewport) and measuring `scrollWidth` against `clientWidth`, rather than
eyeballing screenshots. Both widths now report zero horizontal overflow on all three tabs. Two real bugs
turned up and are fixed:

- The masthead's second row overflowed by 24px at a 345px viewport, putting a horizontal scrollbar under
  the whole page and clipping the *Dad* button. The "Picking as" label now hides below 430px and the row
  wraps instead of overflowing.
- The game rows overflowed by 9px because `grid-template-columns: 1fr` refuses to shrink a track below its
  content's min-content width, and the team nickname is `white-space: nowrap`. Tracks are `minmax(0,1fr)`
  and the nickname has `min-width:0`, so it ellipsises instead of pushing the row wide.

Tap targets on a phone: pick buttons 46px tall, week buttons 42x40. Wide tables (the ledger, the teams
list) scroll inside their own `.tblwrap` containers; the page body never scrolls sideways.

## Design

The visual system follows `C:\Projects\portfolio-website\docs\DESIGN.md`: every neutral tinted toward the
canvas (never `#000`/`#fff`), hairline borders, sharp 2px corners, one accent held under ~10% of any view,
ambient motion that never performs, reduced-motion as a first-class state. Type is that system's three
families in the same three roles — Bricolage Grotesque (display), Public Sans (body), Martian Mono (the
"voice": eyebrows, column heads, codes and figures).

Club marks follow the portfolio's brand-icon rule — *real colored marks, never tinted silhouettes, never
wordmarks*. Light and dark variants both ship and CSS shows whichever suits the viewer's theme. Club color
appears in exactly one place where it carries data: the favored-games bar on the Teams tab.
