"""
End-to-end tests for Metal Mahjong, run in headless Chromium with every external
service mocked (MusicBrainz, Cover Art Archive, Deezer, iTunes, Google Fonts).

    pip install playwright && playwright install chromium
    node tools/build.mjs && python tests/e2e.py

Exits non-zero on the first failed check.
"""
import base64, json, re, struct, sys, threading, urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC")
WAV = b"RIFF" + struct.pack("<I", 36 + 1600) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 8000, 1, 8) + b"data" + struct.pack("<I", 1600) + b"\x80" * 1600

src = (ROOT / "src" / "catalog.js").read_text()
CATALOG = {}
for line in src.split("`")[1].strip().split("\n"):
    f = line.split("|")
    CATALOG[(f[2], f[3])] = f[0]

calls = {"mb": 0}
def mock_mb(route):
    calls["mb"] += 1
    q = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)["query"][0]
    rgs = [{"id": "rg-" + str(abs(hash(a + t))), "title": t, "primary-type": "Album", "secondary-types": [],
            "first-release-date": CATALOG.get((a, t), "1990") + "-01-01", "artist-credit": [{"name": a}], "score": 100}
           for a, t in ((a.replace('\\"', '"'), t.replace('\\"', '"'))
                        for a, t in re.findall(r'artist:"((?:[^"\\]|\\.)*)" AND releasegroup:"((?:[^"\\]|\\.)*)"', q))]
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"release-groups": rgs}))

def split_term(term):
    artist = next((a for (a, t) in CATALOG if term.startswith(a + " ")), term.split(" ")[0])
    return artist, term[len(artist) + 1:]

def mock_deezer(route):
    u = urllib.parse.urlparse(route.request.url); q = urllib.parse.parse_qs(u.query)
    body = {"data": []}
    if u.path == "/search":
        artist, album = split_term(q["q"][0])
        body = {"data": [{"title": f"{album} Track {i}", "title_short": f"{album} Track {i}", "rank": 1000 - i,
                          "preview": f"https://cdnt-preview.dzcdn.net/{i}.wav",
                          "artist": {"name": artist}, "album": {"title": album}} for i in range(3)]}
    route.fulfill(status=200, content_type="application/javascript", body=f"{q['callback'][0]}({json.dumps(body)})")

def context(browser, viewport, mobile=False, covers_ok=True):
    ctx = browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile)
    ctx.route("https://musicbrainz.org/**", mock_mb)
    if covers_ok:
        ctx.route("https://coverartarchive.org/**", lambda r: r.fulfill(status=200, content_type="image/png", body=PNG))
    else:
        ctx.route("https://coverartarchive.org/**", lambda r: r.fulfill(status=503, body=""))
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    ctx.route("https://api.deezer.com/**", mock_deezer)
    ctx.route("https://itunes.apple.com/**", lambda r: r.fulfill(status=200, content_type="application/json",
              headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"results": []})))
    ctx.route("https://cdnt-preview.dzcdn.net/**", lambda r: r.fulfill(status=200, content_type="audio/wav", body=WAV))
    return ctx

failures = 0
def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok: failures += 1

def open_game(ctx):
    page = ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/index.html")
    page.wait_for_function("tiles.length > 0", timeout=60000)
    return page, errors

def play_to_end(page):
    for _ in range(300):
        state = page.evaluate("() => { if (gameOver) return 'over'; const id = bestMove(); if (id === null) return 'stuck'; clickTile(id); return gameOver ? 'over' : 'ok'; }")
        if state != "ok": return state
        page.wait_for_timeout(30)
    return "timeout"

def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])

        # 1. Desktop: precomputed catalog means no MusicBrainz traffic; staged settings; filter start
        ctx = context(browser, {"width": 1400, "height": 850})
        page, errors = open_game(ctx)
        check("desktop uses the wide three-column layout", page.evaluate("document.body.classList.contains('wide')"))
        check("no MusicBrainz requests on startup", calls["mb"] == 0, f"{calls['mb']} requests")
        before = page.evaluate("tiles.map(t => t.face).join()")
        page.select_option("#genreSel", "thrash"); page.select_option("#decadeSel", "1980")
        page.select_option("#diffSel", ".9"); page.uncheck("#sideBlock")
        check("changing settings does not redeal", page.evaluate("tiles.map(t => t.face).join()") == before)
        check("side-blocking rule unchanged until Start", page.evaluate("SIDE_BLOCKING") is True)
        check("Start button shows pending state", "pending" in page.get_attribute("#btnStart", "class"))
        page.click("#btnStart")
        page.wait_for_function("document.querySelector('#layoutName').textContent.includes('Thrash')", timeout=30000)
        years = page.evaluate("[...new Set(tiles.map(t => parseInt(covers[t.face].year, 10)))]")
        check("Thrash/80s board only has 1980s albums", all(1980 <= y <= 1989 for y in years), str(sorted(years)))
        check("new rules applied after Start", page.evaluate("SIDE_BLOCKING") is False)
        check("still no MusicBrainz requests", calls["mb"] == 0, f"{calls['mb']} requests")

        # 2. Full game → end screen → New game; forced loss → Undo
        check("auto-play clears the board", play_to_end(page) == "over")
        page.wait_for_timeout(400)
        s = page.evaluate("""() => ({ title: document.getElementById('overlayText').textContent,
              rows: document.querySelectorAll('.sumItem').length, matched: new Set(matchedLog).size,
              spotify: document.querySelector('.sumItem a.sp')?.href || '', apple: document.querySelector('.sumItem a.am')?.href || '' })""")
        check("end screen shows Cleared", s["title"] == "Cleared!")
        check("end screen lists every matched album", s["rows"] == s["matched"] and s["rows"] > 0, f"{s['rows']} rows")
        check("Spotify/Apple links are plain search links",
              s["spotify"].startswith("https://open.spotify.com/search/") and s["apple"].startswith("https://music.apple.com/us/search?term="))
        page.click("#btnOverlayNew"); page.wait_for_timeout(400)
        check("New game resets logs", page.evaluate("matchedLog.length === 0 && music.played.length === 0 && !gameOver"))
        lost = page.evaluate("""() => { for (let k = 0; k < 10 && !gameOver; k++) { const a = aliveSet();
              const t = tiles.find(t => t.alive && freeWith(t, a) && !tray.some(j => tiles[j].face === t.face));
              if (!t) break; clickTile(t.id); } return document.getElementById('overlayText').textContent; }""")
        check("four unmatched tiles lose the game", lost == "Tray full")
        page.click("#btnOverlayUndo"); page.wait_for_timeout(200)
        check("Undo after a loss reopens play", page.evaluate("!gameOver && tray.length === 3"))
        check("no page errors (desktop)", not errors, "; ".join(errors))
        ctx.close()

        # 3. Phone: small board, compact layout, hamburger menu
        ctx = context(browser, {"width": 390, "height": 844}, mobile=True)
        page, errors = open_game(ctx)
        n = page.evaluate("tiles.length")
        check("phone gets a small board", 36 <= n <= 64, f"{n} tiles")
        m = page.evaluate("""() => ({ credit: getComputedStyle(document.querySelector('.credit')).display,
              bottom: document.getElementById('sizer').getBoundingClientRect().bottom })""")
        check("phone hides credits", m["credit"] == "none")
        check("phone board fits on screen", m["bottom"] <= 844, f"bottom {m['bottom']:.0f}")
        page.tap("#menuBtn")
        check("menu opens", page.evaluate("document.getElementById('menuPanel').classList.contains('open')"))
        page.select_option("#diffSel", ".25")
        check("menu stays open while changing settings", page.evaluate("document.getElementById('menuPanel').classList.contains('open')"))
        page.tap("#btnHint")
        check("menu closes after an action", not page.evaluate("document.getElementById('menuPanel').classList.contains('open')"))
        check("no page errors (phone)", not errors, "; ".join(errors))
        ctx.close()

        # 4. Cover Art Archive outage: tiles fall back to text and the player is told
        ctx = context(browser, {"width": 1400, "height": 850}, covers_ok=False)
        page, errors = open_game(ctx)
        page.wait_for_timeout(1500)
        fb = page.evaluate("document.querySelectorAll('.tile .fallback').length")
        check("tiles show text when covers fail", fb > 0, f"{fb} fallback tiles")
        check("outage warning shown", "Cover Art Archive" in page.inner_text("#status"))
        check("no page errors (outage)", not errors, "; ".join(errors))
        ctx.close()

        browser.close()
    server.shutdown()
    print(f"\n{'All checks passed' if not failures else str(failures) + ' check(s) failed'}")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
