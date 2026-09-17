# Metal Mahjong — handoff overview

Mahjong solitaire (tray variant) where every tile is a classic metal album cover, with a
soundtrack that follows the albums you match. Personal, non-commercial hobby project by
Jason Wellman.

- **Live:** https://wellmanaz.github.io/Metal-Mahjong/
- **Repo:** `wellmanaz/Metal-Mahjong` (GitHub Pages, branch `main`, folder `/`)
- **Shipped artifact:** one self-contained `index.html` (HTML + CSS + JS, no build-time
  dependencies, no framework). `src/` holds the same code split into parts; `tools/build.mjs`
  concatenates them.

---

## 0. Status

Handoff steps completed 2026-09-16: precompute run (980/980 rows matched, 1 without cover art:
Haken — Affinity), `index.html` rebuilt, `tests/layouts.test.mjs` and `tests/e2e.py` all passing.

Still to do after each deploy: verify the live site loads a board with no requests to
`musicbrainz.org` (DevTools → Network).

## 1. Quick start

```bash
node tools/build.mjs                 # src/* -> index.html (also syntax-checks the script)
node tests/layouts.test.mjs          # layout + dealing checks, no browser
pip install playwright && playwright install chromium
python tests/e2e.py                  # headless browser tests, all network mocked
python -m http.server 8000           # then open http://localhost:8000/
```

Deploy = commit `index.html` to `main`. Pages redeploys in ~1–2 minutes.

**Always edit `src/`, never `index.html` directly.** Rebuild, run both test files, then commit
`src/` and `index.html` together.

## 2. Repo layout

| Path | What it is |
|---|---|
| `index.html` | Built output that GitHub Pages serves. Do not hand-edit. |
| `src/head.html` | `<head>`, all CSS, all markup, opens `<script>`. |
| `src/loader.js` | DOM helpers (`$`, `status`), MusicBrainz client, album pool (`loadPool`), precomputed-data seeding. |
| `src/catalog.js` | The curated album catalog (`CATALOG_TEXT`), `GENRES`, `DECADES`, `DECADE_ORDER`. |
| `src/layouts.js` | Board geometry: layout definitions, KMahjongg parser, random generators, blocking rules, tray-aware dealing. |
| `src/game.js` | Game state, rendering, input, tray, hint/auto-pick, end screen, music, settings, menus, boot. Closes `</script></body></html>`. |
| `tools/build.mjs` | Concatenates `src/` in order: head, loader, catalog, layouts, game. |
| `tools/precompute.mjs` | Fills MusicBrainz id / year / cover flag onto each catalog row (see §5). |
| `tests/layouts.test.mjs` | Node checks for every layout and the dealer. |
| `tests/e2e.py` | Playwright tests: desktop, phone, full game, end screen, loss/undo, cover outage. |

All code shares one global script scope (plain `const`/`function` at top level). Load order
matters only for code that runs immediately; most cross-file references happen at runtime.
`seedFromPrecomputed()` (loader.js) is called at the top of game.js because it needs `CATALOG`.

## 3. How the game works

### Rules (tray variant)
- Tap a **free** tile → it moves into a **4-slot tray**. Two identical covers in the tray clear.
  A **4th unmatched** cover in the tray = loss (`TRAY_SIZE = 4`, so at most 3 can be held).
- **Free** = nothing overlapping on the level above AND (if *Side blocking* is on) at least one
  side (left or right, same level) open. Side blocking is a setting; the mobile games this is
  modelled on usually only use the "nothing on top" rule.
- Undo restores the tile and the exact tray state. Shuffle re-deals the remaining board so it is
  still winnable given what is already in the tray (clears undo history).
- Hint: tile that completes a tray cover → else a free matching pair → else advice.
- Optional **auto-pick** (off / 15 / 30 / 60 s): if idle, plays `bestMove()` — completes a tray
  cover, else takes one of a free pair, else the tile that uncovers a match. It wins ~95–100%
  of generated deals, which is why it is opt-in.
- Press-and-drag a tile (>8px) to lift it: tiles it would uncover glow; release snaps it back.

### Coordinates and blocking (`layouts.js`)
- Half-tile units: a tile at `(x, y, z)` covers `x..x+2`, `y..y+2` on level `z`. This allows the
  half-tile row/column staggers and 50% overlaps used by real layouts.
- `overlap(a,b)` = shared area in quarter-tiles (0–4). `buildGeom()` precomputes, per tile,
  `above` (any overlap one level up), `left`/`right` (same level, `dx = ±2`, `|dy| < 2`).
- `freeWith(tile, aliveSet)` is the single source of truth for "free"; it reads the global
  `SIDE_BLOCKING`.

### Layouts
- **Random stack** (default): modelled on current mobile mahjong apps. Dense base grid (some
  columns dropped half a tile, random holes), then 2–3 levels whose tiles are preferentially
  placed half a tile off the tiles below; each must rest at least half on the level below.
  ~65% of boards are mirror-symmetric. Full: 96–144 tiles. Small (phone): 36–64 tiles.
- **Turtle, Spider, Explosion**: real KMahjongg layout data (GPL-2.0-or-later, credited in the
  footer), parsed by `parseKmahjongg()` (quarter-tile ASCII format, `1` marks a tile's top-left).
- **Skull, Lightning Bolt, Amp Stack**: authored with `fromRows()` (one char per tile, `>` shifts a
  row half a tile; unsupported upper tiles are dropped by `dropUnsupported()`).
- **Generated**: older symmetric generator (staggered rows, holes, turtle-style wings).
- **Import layout**: paste any KMahjongg `.layout` file; stored in localStorage.
- `finalizeLayout()` drops one top tile if the count is odd, applies random flips, normalises.

### Dealing (`assignWithTray`)
Faces are assigned by simulating a winning game with the tray: pick a random free tile, then
either "open" a new pair (probability `pOpen` = difficulty: Normal .25 / Hard .6 / Brutal .9;
max 3 open) or "close" an open one, preferring a partner that was **not** reachable when the
first copy was taken. Guarantees at least one winning order and forces tray use. A greedy bot
wins ~30% / 18% / 12% at the three levels.

"Each album twice" (default) = every pair on the board is a different album (up to 72 albums on
a 144-tile board). "Each album 4 times" = classic duplicate-choice difficulty.

### Settings (staged)
Category, decade, board size, layout, copies, difficulty and side blocking are **staged**:
changing them only marks `pendingStart`; the red **▶ Start** button (or New game) applies them
via `startGame()` → `boot()`. Auto-pick delay and music source apply immediately. All settings
persist in localStorage (`metal-mahjong-settings`).

## 4. Albums: catalog → pool → board

- `CATALOG_TEXT` rows: `year|genres|artist|title|mbid|mbYear|cover`
  - `genres`: space-separated from `heavy thrash death black doom sludge power prog groove nu core industrial`
  - `mbid`: MusicBrainz **release-group** id, or `-` when no studio album matched
  - `mbYear`: first-release year from MusicBrainz — this, not the catalog year, decides the decade
  - `cover`: `1` if the Cover Art Archive has a front cover
- Category menu = `GENRES`; decade menu = `DECADE_ORDER` (explicit order — numeric object keys
  would otherwise sort before `"all"`). Decades with no catalog albums for the chosen genre are
  disabled.
- `loadPool(genre, decade)` returns catalog entries for the filter that have a cover and whose
  MusicBrainz year falls in the decade. **No network calls** when every row is precomputed; rows
  missing data fall back to `resolveCatalog()` (browser MusicBrainz lookup, 1 req/s).
- If the pool is smaller than the board needs, albums repeat (status line says so). There is no
  longer any runtime MusicBrainz tag search — it was removed for scale (see §7).
- Covers: `https://coverartarchive.org/release-group/<mbid>/front-250` (hotlinked, never
  re-hosted). If an image fails, the tile shows artist/title text (`fallbackFace`); if most fail,
  the status line reports a Cover Art Archive outage. **Reload covers** re-checks covers this
  browser had marked missing.
- Browser cache: `metal-mahjong-albums-v4` (precomputed data always wins, except covers this
  browser has confirmed missing).

## 5. Maintaining the catalog

1. Add rows to `CATALOG_TEXT` in `src/catalog.js` (`year|genres|artist|title`, leave the last
   three fields off). Use MusicBrainz's spelling of the title.
2. `node tools/precompute.mjs` — looks up only rows without data (1 req/s, identifying
   User-Agent). `--all` rechecks everything; `--covers` rechecks cover flags only.
3. Rows reported as `no match`: fix the title/artist spelling or delete the row.
4. `node tools/build.mjs`, run tests, commit.

The matching rule in `tools/precompute.mjs` (`match`) must stay identical to
`matchReleaseGroup()` in `src/loader.js`.

Current catalog: 980 albums (1970–2025) across 12 genres, all precomputed.

**Hand-filled rows.** Seven rows keep their familiar title/artist even though MusicBrainz files the
album differently (self-titled original, very long or Cyrillic title, a `|` in the title, different
artist credit), so their `mbid|mbYear|cover` were entered by hand: Trouble — Psalm 9, Pentagram —
Relentless, Ulver — Bergtatt, White Zombie — Astro-Creep: 2000, Batushka — Litourgiya,
Dødheimsgard — A Umbra Omega, Nightwish — Human. :II: Nature. The search can't match these, so
`precompute.mjs --all` keeps a row's existing id when it finds no match. Titles must never contain `|`.

## 6. Music

- **Only changes on a match.** `music.onMatch(face)` looks up the album's tracks and plays them
  most-popular-first as 30-second previews, looping until the next match. "Next hit" skips.
- Lookup chain (`albumHits`):
  1. Deezer `search?q=<artist> <album>` via **JSONP** (Deezer's API sends no CORS headers),
     filtered to that artist + album (whole normalised title must prefix-match; "Part I" never
     matches "Part II"; live albums skipped), sorted by Deezer `rank`.
  2. iTunes Search API (fetch, JSONP fallback) — no popularity data, first matches.
  3. Deezer artist top tracks (the album itself isn't on Deezer).
- **Do not use** Deezer's advanced `artist:"…" album:"…"` syntax — it returned zero results for
  40/40 test albums (Sept 2026). The plain query found 32/40; with fallbacks 20/20 in a live test.
- Deezer preview URLs expire; results are cached 20 minutes and refetched once if every preview
  fails to play.
- First tap on the page plays a tiny silent WAV to unlock audio (Safari).
- Music sources: *Album hits (Deezer previews)* or *Spotify playlist embed* (paste a playlist or
  album link; the game can't control that player, so matches don't change it).
- End screen (`showSummary`): every matched album in order, songs heard for each, and plain
  Spotify / Apple Music **search** links (no affiliate or tracking parameters; iTunes results link
  straight to the track with the query string stripped). Pinned **▶ New game**; **Undo** on loss.

## 7. External services and constraints (read before changing anything)

| Service | Used for | Limits / terms that matter |
|---|---|---|
| GitHub Pages | Hosting | Soft 100 GB/month bandwidth (page is ~130 KB, ~41 KB gzipped). Not meant for commercial sites; donation links are explicitly allowed. |
| MusicBrainz | Album ids/years (precompute only) | 1 request/second per IP; wants an identifying User-Agent (browsers can't send one — another reason lookups are precomputed). |
| Cover Art Archive (Internet Archive) | Cover images | Hotlinked. Single point of failure (it was down during the Oct 2024 Internet Archive outage). Covers are copyrighted by labels/artists; not licensed for commercial use. |
| Deezer API | Track ranking + previews | Free API is for personal, non-commercial sites. JSONP only; if Deezer drops JSONP, music needs a small proxy (e.g. Cloudflare Worker). |
| iTunes Search API | Fallback previews | Roughly 20 requests/minute per IP. |
| Spotify | Links + optional playlist embed only | **Do not integrate the Web API / SDK.** Spotify's developer policy forbids using Spotify content in games or quizzes, and dev-mode apps are limited to allow-listed Premium users. A full-length Spotify player was built and deliberately removed. |
| Google Fonts | Metal Mania + Barlow Condensed | Fallback stacks defined. |

**Monetization:** decided against for now. Ads/affiliate would conflict with the Deezer terms and
the unlicensed cover art. Any commercial direction requires original or licensed art and music
first, and moving off GitHub Pages.

## 8. UI structure

- **Wide desktop** (`body.wide`, non-touch, ≥900px): three columns — left gutter (title, info,
  actions, settings, Start), centre board (auto-fit via `fitZoom`, ≤150%), right gutter
  (vertical tray, status, last match, music).
- **Narrow desktop** (<900px): stacked header, board fits width.
- **Phone** (`body.phone`: coarse pointer + short side <600px): small board by default, 64px
  tiles, everything (actions, settings, Start, music) in a ☰ menu that closes when the board is
  touched or an action runs; credits hidden; compact title and tray.
- Tile dimming: `.covered` (something on top) darker than `.sided` (side-blocked); free tiles
  get a light outline.
- `Board: auto / small / full` overrides phone detection.

## 9. localStorage keys

`metal-mahjong-settings`, `metal-mahjong-albums-v4`, `metal-mahjong-custom-layouts`,
`metal-mahjong-zoom`. (Older `-covers-v1/v2`, `-albums-v3`, `-tagfill-v3` keys may linger in
players' browsers; they are unused.)

## 10. Known limitations / next steps

1. **No analytics or error reporting.** Suggested: GoatCounter or Plausible (privacy-friendly),
   plus a `window.onerror` hook that reports to it.
2. **Deezer JSONP dependency** (see §7) — have a proxy plan ready.
3. **Cover Art Archive outage** degrades to text tiles; there is no mirror by design (re-hosting
   covers worsens the copyright position).
4. Dealing retries up to 400 times; a pathological layout could stall a slow phone briefly.
5. Catalog titles that don't match MusicBrainz spelling are dropped at precompute time (listed
   by the tool) — fix or remove them.
6. `render()` rebuilds every tile element on each move; fine at ≤144 tiles.
7. Real-device testing: e2e tests emulate phones in Chromium only; check Safari/iOS audio and
   touch drag on real hardware.

## 11. Conventions

- Keep the shipped site a single self-contained file (no bundler, no runtime dependencies).
- Direct, specific status messages; no silent failures — tell the player what happened.
- Any change to dealing, layouts or blocking: run `tests/layouts.test.mjs`.
- Any UI/flow change: run `tests/e2e.py`; add a check for the new behaviour.
- Respect `prefers-reduced-motion` for new animations.
