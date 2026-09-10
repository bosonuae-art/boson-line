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

## Players

Players are a list, not two hardcoded columns. **Ids are permanent** and are what
picks are filed under; **names are labels** and anyone can change them. That split
is what let Dad become Martin without touching a single stored pick — the id is
still `dad`.

The roster lives in Firestore at `seasons/2026/meta/roster`, not in `localStorage`,
because a player one person adds has to exist on the other phones too; a local
roster would give each device columns the others could not see. Cap is eight,
which is where the colour slots run out.

Colour is positional: eight `--p1…--p8` triples are defined per theme, an element
gets a `pi-N` class, and everything player-coloured reads `var(--p)`. Before this
there were exactly two colours named `--bo` and `--dad`, hardwired into a dozen
selectors.

Open the panel from the name button in the masthead. Tap a row to pick as that
person, type in the field to rename, `×` to remove. **There is no permission
model**: same as the rest of this, anyone with the link can rename anyone or add a
player. For a family sheet that is the right trade; if it ever isn't, the fix is
the sign-in note below.

### Roster edits are ops, not lists

Writing the whole list back is what a two-player sheet gets away with. With three
it means the slower phone deletes whoever the other one just added — and a phone
still holding last week's list, one that has not had its first snapshot yet or has
been in a tunnel, deletes them for everybody. On a sheet where a missing player is
a missing column of picks, that reads as lost data even though the picks are all
still there.

So an edit is not a list. `docs/assets/roster.js` defines five ops — `rename`,
`add`, `remove`, `restore`, `seed` — as a pure reducer over `{players, retired}`.
`store.js` applies each one inside a Firestore transaction against whatever the
document holds at the moment it lands, so two phones editing at once merge
instead of one erasing the other. A transaction needs the network, unlike the
picks queue that Firestore holds offline, so an op that cannot go now waits on a
retry queue; every op is idempotent, which is what lets a queued one be replayed
without first working out whether it already went through. After six failed
attempts it is given up on and said so, rather than spinning against a rule that
will never accept it. Ops this phone has not managed to send are replayed on top
of each incoming snapshot, so an unsent rename stays on screen rather than
flickering back for as long as the write takes.

### Nothing is deleted

Removing somebody moves them to `retired` and leaves their picks exactly where
they are, so **any** phone can put them back and the whole column returns — not
just the phone that removed them, and not just for fifteen seconds. The panel
lists them under *Removed* with a *Bring back* button. `×` also takes two taps
now: the first turns it into *Remove?*, which disarms itself after five seconds.
One tap on a 44px target beside a name field was too easy to hit by accident, and
this is the one control whose effect everybody else sees.

Pasting a pick code is the other way a season can be written over. It can only
ever overwrite a pick, never blank one, but the sheet now reads what was there
first, says how many picks actually moved rather than how big the code was, and
offers them back.

Two knock-on changes worth knowing:

- **Pick codes carry an id now** (`BL2.<id>.<data>`), since one letter cannot name
  an arbitrary player. `BL1` codes still decode, which matters because this
  season's Week 1 was rescued from one.
- **Head to head** only appears with exactly two players. With more it is a table,
  not a number, and the ledger already is that table.

## What the audit changed

A pass over the whole codebase after the roster work turned up seven defects,
four of them shipped:

| Severity | Defect |
|---|---|
| High | **Stored XSS through a player name.** Names are shared, so a name is untrusted input on everyone else's device. Every sink escaped it except the sync line, which assembles HTML for its separators. Proven with `<img onerror>` in a name: script executed on load. |
| High | **A roster was only validated when it arrived from Firestore**, never when read back from this device's own storage. A 500-character name stretched the masthead to 3851px and a duplicated id drew the same player twice. `cleanRoster` now runs at every boundary. |
| Medium | **`renderSwap` still read `s.boIn`/`s.dadIn`**, deleted in the roster refactor, so the Swap panel read *"Bo has undefined of 272 in, Dad has undefined."* |
| Medium | **A player who joins in week 10 was shown as `0-145`** — scored as though they had lost every game they were never present for. Points still come out of every decided game, but a win-loss record now counts only games that player actually picked, with "(145 not picked)" alongside. |
| Medium | **The phone ledger could not wrap.** Fine at two players; at eight it pushed the page 139px sideways. |
| Low | **`.unset .ident .pair` survived the rewrite pointing at nothing** — the highlight that says "tell me who you are" had silently stopped matching any element. |
| Low | Two blues (`--p1`/`--p7`) and two browns (`--p2`/`--p8`) sit at ΔE 16–19, confusable at ledger size. Only reachable at 7–8 players. Mitigated by making the sheet head sticky, so the names never scroll out of view and colour never carries identity alone. |

Checked and found sound: all 16 palette combinations clear 4.5:1 on their own tint
and 3:1 on the page, in both themes; no unnamed buttons, unlabelled inputs or
missing alt text; tabs correctly wired to panels. Render cost is 2.7ms median at
two players and 7.4ms at eight — an early reading of ~1s was background-tab timer
clamping, not the app.

## The live strip

Under the week switcher, one line carries everything the sheet knows right now: what is under way (with
the scores of in-play games), how old the ESPN numbers are, a **Refresh** that forces a pull, and a sync
line saying whether both sheets are in step. Before this you had to read sixteen rows to work out what was
happening, and the freshness stamp was hidden inside the *About* disclosure.

The page refetches on its own — every 20 seconds while a game in the viewed week is live, every ten minutes
otherwise, and whenever the tab regains focus. Coming back to a backgrounded tab also forces a redraw:
`requestAnimationFrame` does not run in a hidden tab, so a page that first loaded in the background has no
frame to build on.

## The sample season

In September the sheet is nearly empty, which makes it a poor thing to show
anyone. **About this sheet → Show a sample** swaps it for an invented week 10 —
nine weeks played, a Sunday half-finished, three games live — so it can be
demonstrated full. `?demo=1` opens straight into it, so the sample can be sent
rather than demonstrated over a shoulder.

`docs/assets/demo.js` generates it at runtime from a fixed seed rather than
shipping a second dataset: everything structural is the real 2026 data already
in `data.js` — schedule, kickoffs, lines, totals, byes, broadcast — and only the
outcomes are invented. That costs about 4KB instead of another 60, and the seed
means both phones see the same sample.

Two properties are enforced rather than trusted, because the sample sits on top
of live shared data:

- **The real season survives underneath.** `real` holds the genuine ledger while
  the sample is showing; `persist()` and `mergeRemote()` write there, never to
  the sample, so a snapshot arriving mid-demo lands where it belongs.
- **Nothing from the sample can leave the device.** Every write path — `setPicks`,
  `setResult`, `pendMark`, `pullWeek` — checks the flag first. Verified: picks
  made inside the sample leave `bl.book`, `bl.pend` and Firestore untouched.

## Installing it on a phone

`manifest.webmanifest` plus `sw.js` make it installable — *Add to Home Screen* on
iOS, *Install app* on Android — after which it opens standalone, with no browser
chrome, off its own icon.

The service worker is **network first, cache as fallback**. The other way round is
faster but lets a push sit behind a stale cache for a reload or two, and this is
edited far more often than it is opened on a train. It only touches same-origin
`GET`s: ESPN, Google Fonts and Firestore are left alone, since they must never be
served a stale score.

## The shared ledger

Picks sync live through Firestore. Project **`boson-line`**, data at
`seasons/2026/weeks/w1` … `w18`, each
`{ picks: {AWAY@HOME: {bo, dad}}, results: {...}, touch: {bo, dad}, updatedAt }`.
The header pill reads *In sync* when it's connected and *On this device* when it isn't; the app is
fully usable either way, and the season pick-code still works as a backup or for moving to a new phone.

Three things make the sync trustworthy rather than merely present:

- **`touch`** stamps each save with the server clock per person, so the sheet can say *"Dad 7 of 16 this
  week, last change just now"* instead of only *"connected"*. That is the difference between believing it
  works and hoping it does. It is a courtesy signal, not a credential — anyone who can write picks can
  write it.
- **Pending edits survive a snapshot.** A remote snapshot replaces a week wholesale, so a pick made while
  the connection was still opening — or on a train — used to be drawn on screen and then silently erased.
  Local edits are now held in `bl.pend` and reapplied on top of whatever arrives, cleared only when the
  *server* echoes them back. Firestore replays a local write immediately, before the server has taken it,
  so reconciling on that echo would let *"Everything saved"* lie; the app waits for a snapshot with no
  writes still in flight.
- **Failed writes retry** with backoff instead of being dropped, and anything still stranded on the phone
  is flushed once the sheet has been read - never before it.
- **Stale intent expires.** Every pending edit carries the moment it was made, and is dropped when the
  sheet already agrees, when the sheet was written *after* the edit was made (the newer intention wins),
  or when it is more than twelve hours old. Without this, `bl.pend` replayed on every load: a week cleared
  by a stray click came back from the dead on the next page open and wiped a freshly restored one. Twice.

A pick arriving from the other phone gets one beat of highlight on its row, so a change that lands while
you are looking at the week is visible rather than merely present.

**There is no sign-in.** Anonymous auth was the obvious thing to require, but it is not a real gate —
anyone can mint an anonymous token in one call — and enabling it meant turning on Identity Platform, a
separate paid product, for no security gain. `firestore.rules` carries the restriction instead: a caller
can only touch those 18 documents, can only store the three fields the app writes, and is refused
everywhere else in the project. Verified against the live project:

| Request | Result |
|---|---|
| write a valid week (`w2`, `picks`) | accepted |
| write `touch.bo` / `touch.dad` | accepted |
| write `touch.pete` (a third name) | rejected |
| write a bogus week id (`w99`) | rejected |
| write an unknown field | rejected |
| write `touch` as a string, not a map | rejected |
| write another collection | rejected |
| write another season (`2027`) | rejected |

Deletes are refused too, as a side effect rather than by design: the rule reads
`request.resource.data.keys()`, and on a delete there is no `request.resource`. Clearing a field means
`PATCH`ing it away, not deleting the document.

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
- The Pages build refetches the viewed week every 20s while a game in it is live, every 10 minutes
  otherwise, and whenever the tab regains focus.
- The Line column's second line names the number the market moved *from* (`was PIT -3`) rather than a bare
  delta (`+½`), which nobody could read at a glance.
- **Clear mine** wipes a week in one press, so it offers an undo for fifteen seconds afterwards. It was
  added the hard way, after a stray click cleared a real week and it turned out there was no way back
  except a pick code.

## Phone layout

The first version of this was desktop-shaped and squeezed: the sheet's five columns
reflowed into stacked label/value fragments, section tabs sat in the top-right
corner, and eighteen 40px week buttons lived in a strip that opened scrolled to
week one. It measured fine and felt like an afterthought, because it was one.

Rebuilt phone-first against three findings:

- **The bottom third is where the thumb rests**; the top corners are the hardest
  reach on a large handset, and bottom tab bars suit 3–5 sections with targets of
  at least 44px. Section switching moved from the top-right corner to a fixed
  bottom bar — the same three buttons and the same wiring, just placed where the
  hand already is. Pick buttons went to 52px.
- **Cards are for records read one at a time; tables are for comparison**, and
  reflowing a table into labelled fragments makes "all table interactions
  nonsense". So the two halves of this app diverge. A game is one decision, so it
  became a decision row: a quiet line of context, two targets, a quiet line of
  consequence. The standings are pure comparison — Bo against Dad against Vegas
  across a row — so they *stay a table*, made usable rather than reflowed.
- **Lock the leftmost column and stick the header** when a comparison table has to
  scroll sideways, rather than hiding columns or forcing landscape. The ledger's
  week column is pinned and its head sticks, so a row never loses its name and a
  column never loses its meaning.

Also: your own pick is hidden from the ledger on a phone, because the button you
pressed is already lit and repeating it cost a third of the row; the week control
became `‹ Week 10 ›` plus an **All** grid of eighteen 44px targets; and the number
that actually drives the visit — how many games still want a pick — leads the
summary line.

The first game now sits 325px down a 390px-wide screen with four games visible,
against roughly 537px and one before. The masthead is sticky, so that header is a
one-time cost rather than a permanent tax.

Sources: [NN/g on mobile tables](https://www.nngroup.com/articles/mobile-tables/),
[table vs list vs cards](https://uxpatterns.dev/pattern-guide/table-vs-list-vs-cards),
[thumb-zone guidance](https://parachutedesign.ca/blog/thumb-zone-ux/).

## Earlier phone fixes

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

The week strip is wider than a phone from week nine on and used to open scrolled to week one, so the week
you were actually in sat off the end of it. It now centres on the current week.

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
