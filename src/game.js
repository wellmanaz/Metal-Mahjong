/* ---------- Game ---------- */
seedFromPrecomputed();
let TILE = 116, HALF = 58, DEPTH = 10, PAD = 20;
/* Phone detection: touch-first device with a small screen. */
const isPhone = () =>
  matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
document.body.classList.toggle("phone", isPhone());
const wideMQ = matchMedia("(min-width: 900px)");
const isWide = () => !isPhone() && wideMQ.matches;
function applyWide() { document.body.classList.toggle("wide", isWide()); }
applyWide();
/* Size the board to the space it has: fill the whole centre on wide screens,
   fill the width elsewhere (the page scrolls vertically). */
function autoFit() {
  if (!tiles.length) return;
  if (isWide()) fitZoom(1.5); else fitWidth();
}
function applyBoardSize() {
  const pref = $("sizeSel").value;
  SMALL_BOARD = pref === "small" || (pref === "auto" && isPhone());
  TILE = SMALL_BOARD ? 64 : 116;
  HALF = TILE / 2;
  DEPTH = SMALL_BOARD ? 5 : 10;
  PAD = SMALL_BOARD ? 10 : 20;
  document.body.classList.toggle("small", SMALL_BOARD);
  document.body.style.setProperty("--tile", TILE + "px");
  document.body.style.setProperty("--tile-pad", SMALL_BOARD ? "3px" : "5px");
}
let covers = [], tiles = [], tray = [], history = [], layoutName = "", gameOver = false, lastFace = null;
let matchedLog = [], gameStartedAt = 0;     // faces in the order they were matched, for the end screen
let zoom = 1;
try { zoom = parseFloat(localStorage.getItem("metal-mahjong-zoom")) || 1; } catch (_) {}

const aliveSet = () => new Set(tiles.filter(t => t.alive).map(t => t.id));
const isFree = (t, alive = aliveSet()) => freeWith(t, alive);
const pOpen = () => parseFloat($("diffSel").value);

function newGame() {
  if (!covers.length) return;
  applyBoardSize();
  const choice = $("layoutSel").value;
  const names = Object.keys(LAYOUTS);
  // on a small board, "Any layout" only picks from the generators that scale down
  const pool = SMALL_BOARD ? ["Random stack"] : names;
  layoutName = choice === "*" ? pool[rnd(pool.length)] : choice;
  let geom;
  try { geom = buildGeom(finalizeLayout(LAYOUTS[layoutName](), true)); }
  catch (e) { status(`Layout "${layoutName}" failed to load: ${e.message}`); return; }
  const order = shuffleArr(covers.map((_, i) => i));
  const pairsPerAlbum = +$("copiesSel").value / 2;
  const facePairs = [];
  for (let i = 0; i < geom.length / 2; i++) facePairs.push(order[Math.floor(i / pairsPerAlbum) % order.length]);
  const asg = assignWithTray(geom, geom.map(g => g.id), facePairs, [], pOpen());
  if (!asg) { status(`Couldn't deal a winnable game on "${layoutName}". Pick another layout.`); return; }
  tiles = geom.map(g => ({ ...g, face: asg.get(g.id), alive: true }));
  tray = []; history = []; gameOver = false; lastFace = null;
  matchedLog = []; gameStartedAt = Date.now();
  $("lastCover").removeAttribute("src");
  $("lastBtn").disabled = true;
  $("lastInfo").innerHTML = `<div class="album">Tap free tiles to move them into the tray.</div>`;
  $("overlay").classList.remove("show");
  const albumsUsed = new Set(facePairs).size;
  const fl = filterLabel();
  $("layoutName").textContent = `${fl ? fl + " · " : ""}${layoutName}, ${Math.max(...geom.map(t => t.z)) + 1} levels, ${albumsUsed} albums`;
  status("Two matching covers in the tray clear. A fourth unmatched cover loses.");
  render();
  autoFit();
  $("boardWrap").scrollTo(0, 0);
  music.boardChanged();
  resetAuto();
}

function boardSize() {
  const maxZ = Math.max(0, ...tiles.map(t => t.z));
  const off = PAD + maxZ * DEPTH;
  return {
    off,
    w: off + (Math.max(...tiles.map(t => t.x)) + 2) * HALF + PAD,
    h: off + (Math.max(...tiles.map(t => t.y)) + 2) * HALF + PAD
  };
}

const coverTitle = c => `${c.artist} — ${c.title}${c.year ? " (" + c.year + ")" : ""}`;

function render() {
  const board = $("board");
  board.innerHTML = "";
  const alive = aliveSet();
  const { off, w, h } = boardSize();
  for (const t of tiles) {
    if (!t.alive) continue;
    const c = covers[t.face];
    const el = document.createElement("div");
    const covered = t.above.some(i => alive.has(i));
    el.className = "tile " + (covered ? "blocked covered" : freeWith(t, alive) ? "free" : "blocked sided");
    el.style.left = (off + t.x * HALF - t.z * DEPTH) + "px";
    el.style.top = (off + t.y * HALF - t.z * DEPTH) + "px";
    el.style.zIndex = t.z * 10000 + t.y * 100 + t.x;
    el.title = coverTitle(c);
    el.tabIndex = 0;
    el.dataset.id = t.id;
    if (coverHealth.failed.has(c.id)) el.appendChild(fallbackFace(c));
    else {
      const img = document.createElement("img");
      img.alt = el.title;
      img.onload = () => coverLoaded(c.id);
      img.onerror = () => { coverFailed(c.id); img.replaceWith(fallbackFace(c)); };
      img.src = coverUrl(c.id);
      el.appendChild(img);
    }
    board.appendChild(el);
  }
  board.style.width = w + "px";
  board.style.height = h + "px";
  applyZoom();
  renderTray();
  $("tilesLeft").textContent = `${alive.size} tiles`;
  $("btnUndo").disabled = !history.length;
}

/* When a cover image fails, the tile shows the artist and album as text so the
   game stays playable; if most covers fail, the Cover Art Archive is probably down. */
const coverHealth = { ok: new Set(), failed: new Set(), warned: false };
function fallbackFace(c) {
  const f = document.createElement("div");
  f.className = "fallback";
  const a = document.createElement("b"); a.textContent = c.artist;
  const t = document.createElement("span"); t.textContent = c.title;
  f.append(a, t);
  return f;
}
function coverLoaded(id) { coverHealth.ok.add(id); }
function coverFailed(id) {
  coverHealth.failed.add(id);
  const f = coverHealth.failed.size, o = coverHealth.ok.size;
  if (!coverHealth.warned && f >= 6 && f > o) {
    coverHealth.warned = true;
    status("The Cover Art Archive isn't responding, so tiles show album names instead. Try Reload covers later.");
  }
}

function renderTray() {
  const el = $("tray");
  el.innerHTML = "";
  for (let i = 0; i < TRAY_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.setAttribute("role", "listitem");
    const id = tray[i];
    if (id !== undefined) {
      const c = covers[tiles[id].face];
      const img = document.createElement("img");
      img.alt = coverTitle(c); img.title = coverTitle(c);
      if (coverHealth.failed.has(c.id)) slot.appendChild(fallbackFace(c));
      else { img.onerror = () => img.replaceWith(fallbackFace(c)); img.src = coverUrl(c.id); slot.appendChild(img); }
    }
    el.appendChild(slot);
  }
  el.classList.toggle("danger", tray.length >= TRAY_SIZE - 1);
}

function applyZoom() {
  const board = $("board");
  const w = parseFloat(board.style.width) || 0, h = parseFloat(board.style.height) || 0;
  board.style.transform = `scale(${zoom})`;
  $("sizer").style.width = w * zoom + "px";
  $("sizer").style.height = h * zoom + "px";
  try { localStorage.setItem("metal-mahjong-zoom", zoom); } catch (_) {}
}
function setZoom(z) { zoom = Math.max(.3, Math.min(2, Math.round(z * 100) / 100)); applyZoom(); }
function fitWidth() {
  const w = parseFloat($("board").style.width);
  zoom = Math.min(1.6, ($("boardWrap").clientWidth - 8) / w);
  applyZoom();
}
function fitZoom(max = 2) {
  const board = $("board"), wrap = $("boardWrap");
  const w = parseFloat(board.style.width), h = parseFloat(board.style.height);
  setZoom(Math.min(max, (wrap.clientWidth - 28) / w, (wrap.clientHeight - 28) / h));
}

function clickTile(id) {
  if (gameOver) return;
  const t = tiles[id];
  if (!t || !t.alive || !isFree(t)) return;
  history.push({ id, tray: tray.slice() });
  t.alive = false;
  const k = tray.findIndex(j => tiles[j].face === t.face);
  if (k >= 0) {
    tray.splice(k, 1);
    matchedLog.push(t.face);
    history[history.length - 1].matched = true;
    showMatch(t.face);
    music.onMatch(t.face);
    status("");
  } else {
    tray.push(id);
    status(tray.length === TRAY_SIZE - 1 ? "One slot left. Only a match is safe now." : "");
  }
  render();
  if (tray.length >= TRAY_SIZE) {
    gameOver = true;
    status("Tray full. Undo to back out, or start a new game.");
    showSummary(false);
  } else if (!tiles.some(t => t.alive) && !tray.length) {
    gameOver = true;
    showSummary(true);
  }
  resetAuto();
}

function showMatch(face) {
  const c = covers[face];
  lastFace = face;
  $("lastCover").src = coverUrl(c.id, 250);
  $("lastCover").alt = coverTitle(c);
  $("lastBtn").disabled = false;
  $("lastInfo").innerHTML = "";
  const a = document.createElement("div"); a.className = "artist"; a.textContent = c.artist;
  const b = document.createElement("div"); b.className = "album"; b.textContent = c.title + (c.year ? ` (${c.year})` : "");
  $("lastInfo").append(a, b);
}

function undo() {
  const last = history.pop();
  if (!last) return;
  tiles[last.id].alive = true;
  tray = last.tray;
  if (last.matched) matchedLog.pop();
  gameOver = false;
  $("overlay").classList.remove("show");
  status("");
  render();
  resetAuto();
}

function flash(ids) {
  ids.forEach((id, i) => {
    const el = document.querySelector(`.tile[data-id="${id}"]`);
    if (!el) return;
    el.classList.remove("hint"); void el.offsetWidth; el.classList.add("hint");
    if (i === 0) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  });
}

function hint() {
  if (gameOver) return;
  const alive = aliveSet();
  const free = tiles.filter(t => t.alive && freeWith(t, alive));
  const trayMatch = free.find(t => tray.some(j => tiles[j].face === t.face));
  if (trayMatch) { flash([trayMatch.id]); status("That one completes a cover in the tray."); return; }
  const byFace = {};
  free.forEach(t => (byFace[t.face] ||= []).push(t));
  const pair = Object.values(byFace).find(g => g.length >= 2);
  if (pair && tray.length <= TRAY_SIZE - 2) { flash([pair[0].id, pair[1].id]); status("Those two match each other."); return; }
  status(tray.length >= TRAY_SIZE - 1
    ? "No safe move. Undo or shuffle."
    : "No match is reachable. Take a tile you think uncovers something useful.");
}

function reshuffle() {
  if (gameOver) return;
  const alive = tiles.filter(t => t.alive);
  if (!alive.length) return;
  const counts = {};
  alive.forEach(t => counts[t.face] = (counts[t.face] || 0) + 1);
  const trayFaces = tray.map(j => tiles[j].face);
  trayFaces.forEach(f => counts[f]--);          // each tray tile's partner stays on the board
  const pairFaces = [];
  for (const [f, n] of Object.entries(counts)) for (let i = 0; i < n / 2; i++) pairFaces.push(+f);
  const asg = assignWithTray(tiles, alive.map(t => t.id), shuffleArr(pairFaces), trayFaces, pOpen());
  if (!asg) { status("Couldn't find a winnable shuffle from here. Try undo."); return; }
  alive.forEach(t => t.face = asg.get(t.id));
  history = [];
  status("Shuffled into a winnable arrangement. Undo history cleared.");
  render();
  resetAuto();
}

/* ---------- End screen ----------
   Every album matched this game, with the songs that played for it and plain
   search links to Spotify and Apple Music (no affiliate or tracking parameters). */
const spotifyLink = q => `https://open.spotify.com/search/${encodeURIComponent(q)}`;
const appleLink = q => `https://music.apple.com/us/search?term=${encodeURIComponent(q)}`;
function hx(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
}
function linkPair(q, appleUrl) {
  return hx("span", { class: "links" },
    hx("a", { class: "sp", href: spotifyLink(q), target: "_blank", rel: "noopener noreferrer", text: "Spotify" }),
    hx("a", { class: "am", href: appleUrl || appleLink(q), target: "_blank", rel: "noopener noreferrer", text: "Apple Music" }));
}
function formatDuration(ms) {
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
function showSummary(won) {
  const title = $("overlayText");
  title.textContent = won ? "Cleared!" : "Tray full";
  title.classList.toggle("lost", !won);
  const totalPairs = tiles.length / 2;
  const left = tiles.filter(t => t.alive).length;
  $("sumStats").textContent = [
    `${matchedLog.length} of ${totalPairs} pairs matched`,
    won ? null : `${left} tiles left on the board`,
    `${formatDuration(Date.now() - gameStartedAt)}`,
    filterLabel() || null,
  ].filter(Boolean).join(" · ");

  const list = $("sumList");
  list.replaceChildren();
  const order = [], counts = new Map();
  for (const f of matchedLog) {
    if (!counts.has(f)) order.push(f);
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  if (!order.length) list.append(hx("li", { class: "sumEmpty", text: "No pairs matched this time." }));
  for (const f of order) {
    const c = covers[f];
    const songs = music.played.filter(p => p.face === f);
    const songList = hx("ul", { class: "sumSongs" },
      songs.length
        ? songs.map(s => hx("li", {},
            hx("span", {}, hx("span", { class: "note", text: "♪ " }), s.title,
              s.artist && norm(s.artist) !== norm(c.artist) ? ` (${s.artist})` : ""),
            linkPair(`${s.artist || c.artist} ${s.title}`, s.appleUrl)))
        : hx("li", { class: "none", text: "No song played for this album" }));
    list.append(hx("li", { class: "sumItem" },
      hx("img", { src: coverUrl(c.id), alt: "", loading: "lazy" }),
      hx("div", { class: "sumText" },
        hx("div", { class: "sumAlbum" },
          hx("b", { text: c.artist }), ` — ${c.title} `,
          c.year ? hx("span", { class: "yr", text: `(${c.year})` }) : null,
          counts.get(f) > 1 ? hx("span", { class: "sumCount", text: ` ×${counts.get(f)}` }) : null),
        linkPair(`${c.artist} ${c.title}`),
        songList)));
  }
  list.scrollTop = 0;
  $("btnOverlayUndo").hidden = won;
  $("overlay").classList.add("show");
  $("btnOverlayNew").focus();
}

/* ---------- Auto-pick (optional) ----------
   If enabled and no tile is picked within the chosen delay, the best move is made:
   1) a free tile that completes a cover in the tray,
   2) one of a matching pair that are both free,
   3) the free tile whose removal uncovers a match (its own partner, a tray
      partner, or a partner of another free tile), then whichever uncovers most.
   With one tray slot left and no completing tile, it does nothing. */
let autoTimer = null;

function resetAuto() {
  clearTimeout(autoTimer);
  autoTimer = null;
  const secs = +$("autoPick").value;
  const bar = $("autoBar");
  $("autoTrack").hidden = !secs;
  bar.classList.remove("run");
  if (!secs || gameOver || !tiles.some(t => t.alive) || document.hidden) return;
  bar.style.setProperty("--auto-dur", secs + "s");
  void bar.offsetWidth;                 // restart the CSS animation
  bar.classList.add("run");
  autoTimer = setTimeout(autoPick, secs * 1000);
}

function bestMove() {
  const alive = aliveSet();
  const free = tiles.filter(t => t.alive && freeWith(t, alive));
  if (!free.length) return null;
  const trayFaces = new Set(tray.map(j => tiles[j].face));
  const completes = free.find(t => trayFaces.has(t.face));
  if (completes) return completes.id;
  if (tray.length >= TRAY_SIZE - 1) return null;
  const byFace = {};
  free.forEach(t => (byFace[t.face] ||= []).push(t));
  const pair = Object.values(byFace).find(g => g.length >= 2);
  if (pair) return pair[0].id;
  let best = null, bestScore = -1;
  for (const t of free) {
    const without = new Set(alive);
    without.delete(t.id);
    const exposed = tiles.filter(u => u.alive && u.id !== t.id && !freeWith(u, alive) && freeWith(u, without));
    let score = exposed.length;
    if (exposed.some(u => u.face === t.face)) score += 1000;
    if (exposed.some(u => trayFaces.has(u.face))) score += 500;
    if (exposed.some(u => free.some(f => f.id !== t.id && f.face === u.face))) score += 300;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best ? best.id : null;
}

function autoPick() {
  autoTimer = null;
  $("autoBar").classList.remove("run");
  if (gameOver) return;
  if (drag) { autoTimer = setTimeout(autoPick, 1000); return; }   // wait until the peek ends
  const id = bestMove();
  if (id === null) { status("Time's up, but there's no safe move to make for you."); return; }
  flash([id]);
  status("Time's up. Auto-picked the best move.");
  setTimeout(() => { if (!gameOver && tiles[id].alive && !drag) clickTile(id); else resetAuto(); }, 500);
}
document.addEventListener("visibilitychange", resetAuto);

/* ---------- Music ----------
   The song only changes when you make a match. The matched album's tracks are
   ranked by Deezer popularity and played in that order (30-second previews),
   looping until the next match. iTunes is the fallback. */
function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now() + "_" + rnd(1e6);
    const s = document.createElement("script");
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error("timeout")); }, timeout);
    window[cb] = data => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error("script failed")); };
    s.src = url + "&callback=" + cb;
    document.head.appendChild(s);
  });
}

/* Album hits, most popular first. Lookup order:
   1) Deezer search for "artist title", filtered to that album
   2) iTunes search for the album
   3) Deezer top tracks for the artist (so a match always changes the song
      when the band is on Deezer at all). */
const hitsCache = {};
const deezerTrack = x => ({ title: x.title_short || x.title, artist: x.artist.name, album: x.album?.title || "", preview: x.preview, rank: x.rank || 0 });
function rankedUnique(list) {
  const seen = new Set();
  return list.sort((a, b) => b.rank - a.rank).filter(x => {
    const k = norm(x.title);
    if (!x.preview || seen.has(k)) return false;
    seen.add(k); return true;
  });
}
async function albumHits(c, fresh = false) {
  const cached = hitsCache[c.id];
  if (!fresh && cached && Date.now() - cached.at < 20 * 60 * 1000) return cached.list;   // Deezer preview links expire
  const na = norm(c.artist).slice(0, 8), nt = norm(c.title);
  const artistOk = name => norm(name || "").includes(na);
  // whole title must match (a "(Remastered)"-style suffix is fine); "Part I" must not pick up "Part II"
  const albumOk = t => {
    const n = norm(t || "");
    if (!n.startsWith(nt) || /\blive\b/i.test(t || "")) return false;
    return !(/(^|[^a-z])i$/i.test(c.title.trim()) && /^i/.test(n.slice(nt.length)));
  };
  let list = [], source = "album";
  const deezerAlbum = async q => {
    const data = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=50&output=jsonp`);
    return rankedUnique((data.data || []).filter(x => artistOk(x.artist?.name) && albumOk(x.album?.title)).map(deezerTrack));
  };
  // Deezer's advanced artist:"" album:"" syntax returns nothing via JSONP (tested Sept 2026),
  // so use a plain search and filter the results ourselves.
  try { list = await deezerAlbum(`${c.artist} ${c.title}`); } catch (e) { console.warn("Deezer lookup failed", e); }
  if (!list.length) {
    try {
      const url = `https://itunes.apple.com/search?media=music&entity=song&limit=50&term=${encodeURIComponent(c.artist + " " + c.title)}`;
      let data;
      try { data = await (await fetch(url)).json(); } catch (_) { data = await jsonp(url); }
      list = (data.results || [])
        .filter(x => x.previewUrl && artistOk(x.artistName) && albumOk(x.collectionName))
        .map(x => ({ title: x.trackName, artist: x.artistName, album: x.collectionName, preview: x.previewUrl,
                     appleUrl: (x.trackViewUrl || "").split("?")[0] || null }));
    } catch (e) { console.warn("iTunes lookup failed", e); }
  }
  if (!list.length) {
    try {
      const ar = await jsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(c.artist)}&limit=10&output=jsonp`);
      const artist = (ar.data || []).find(x => norm(x.name) === norm(c.artist)) || (ar.data || []).find(x => artistOk(x.name));
      if (artist) {
        const top = await jsonp(`https://api.deezer.com/artist/${artist.id}/top?limit=15&output=jsonp`);
        list = rankedUnique((top.data || []).map(deezerTrack));
        source = "artist";
      }
    } catch (e) { console.warn("Deezer artist lookup failed", e); }
  }
  list.source = source;
  hitsCache[c.id] = { at: Date.now(), list };
  return list;
}

const music = {
  audio: new Audio(),
  on: true,
  playing: false,
  hits: [], idx: 0, face: null, token: 0,
  played: [],       // songs heard this game, for the end screen
  mode() { return $("musSource").value; },

  now(text, track) {
    const el = $("musNow");
    if (!track) { el.textContent = text; return; }
    el.innerHTML = "";
    const b = document.createElement("b"); b.textContent = track.title;
    el.append(b, document.createTextNode(` by ${track.artist}, from ${track.album}${text ? " " + text : ""}`));
  },
  setPlaying(p) { this.playing = p; $("musPlay").textContent = p ? "Pause" : "Play"; },

  async onMatch(face) {
    const mode = this.mode();
    if (mode === "embed") return;              // the embedded Spotify player can't be controlled from here
    this.on = true;                            // a match always starts music, even if it was paused
    const my = ++this.token;
    const c = covers[face];
    this.now(`Finding the biggest songs on ${c.title}…`);
    let hits = [];
    try { hits = await albumHits(c); } catch (e) { console.warn(e); }
    if (my !== this.token) return;
    if (!hits.length) {
      console.warn("No preview found for", c.artist, "—", c.title);
      this.now(`Couldn't find ${c.artist} on Deezer or iTunes. Keeping the current song.`);
      return;
    }
    this.face = face; this.hits = hits; this.idx = 0;
    this.playPreview(0, my);
  },

  async playPreview(i, my = this.token, retried = false) {
    for (let n = 0; n < this.hits.length; n++) {
      const idx = (i + n) % this.hits.length;
      const h = this.hits[idx];
      if (!h.preview) continue;
      this.audio.src = h.preview;
      try { await this.audio.play(); }
      catch (e) {
        if (e.name === "NotAllowedError") {       // browser autoplay block: leave it queued for the Play button
          this.idx = idx; this.setPlaying(false);
          this.now("(press Play: the browser blocked autoplay)", h);
          return;
        }
        console.warn(e); continue;
      }
      if (my !== this.token) return;
      this.idx = idx;
      this.setPlaying(true);
      if (!this.played.some(p => p.face === this.face && p.title === h.title))
        this.played.push({ face: this.face, title: h.title, artist: h.artist, appleUrl: h.appleUrl });
      this.now(this.hits.source === "artist"
        ? `(album not on Deezer, playing the band's top songs: ${idx + 1} of ${this.hits.length})`
        : `(hit ${idx + 1} of ${this.hits.length}, preview)`, h);
      return;
    }
    if (!retried && this.face !== null) {               // links probably expired: fetch fresh ones once
      const fresh = await albumHits(covers[this.face], true).catch(() => []);
      if (my !== this.token) return;
      if (fresh.length) { this.hits = fresh; return this.playPreview(0, my, true); }
    }
    this.setPlaying(false);
    this.now("Previews for this album wouldn't play.");
  },

  next() {
    if (!this.hits.length) return;
    this.on = true;
    this.playPreview(this.idx + 1);
  },

  toggle() {
    if (this.playing) { this.audio.pause(); this.on = false; this.setPlaying(false); }
    else if (this.hits.length && this.audio.currentTime === 0) { this.on = true; this.playPreview(this.idx); }
    else if (this.audio.src && !this.audio.ended) { this.on = true; this.audio.play(); this.setPlaying(true); }
    else if (this.hits.length) { this.on = true; this.playPreview(this.idx); }
  },

  stopAll() {
    this.token++;
    this.audio.pause();
    this.setPlaying(false);
  },

  boardChanged() { this.played = []; this.hits = []; this.face = null; this.token++; },   // drop lookups from the last game
};
music.audio.volume = 0.5;
/* Unlock audio on the first tap so songs can start later, after the network lookup
   finishes (Safari otherwise refuses play() outside the original gesture). */
function silentWavUrl() {
  const b = new ArrayBuffer(46), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 38, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, 2, true); v.setUint8(44, 128); v.setUint8(45, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}
document.addEventListener("pointerdown", () => {
  if (music.audio.src) return;
  music.audio.src = silentWavUrl();
  music.audio.play().then(() => music.audio.pause()).catch(() => {});
}, { once: true, capture: true });
music.audio.addEventListener("ended", () => { if (music.on && music.mode() === "board") music.playPreview(music.idx + 1); });

$("musPlay").onclick = () => music.toggle();
$("musNext").onclick = () => music.next();
$("musVol").oninput = e => { music.audio.volume = +e.target.value; };
$("lastBtn").onclick = () => { if (lastFace !== null) { music.on = true; music.onMatch(lastFace); } };

function spotifyEmbed(link) {
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album)\/([A-Za-z0-9]+)/.exec(link || "");
  if (!m) return false;
  const f = document.createElement("iframe");
  f.src = `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0`;
  f.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  f.loading = "lazy";
  f.title = "Spotify player";
  $("spotifyFrame").replaceChildren(f);
  return true;
}
function showMusicSource() {
  const mode = $("musSource").value;
  $("musPlayer").hidden = mode === "embed";
  $("musEmbed").hidden = mode !== "embed";
}
$("musSource").onchange = () => { music.stopAll(); music.hits = []; music.now("Make a match to hear that album's biggest songs."); showMusicSource(); saveSettings(); };
$("spotifyLoad").onclick = () => {
  if (spotifyEmbed($("spotifyUrl").value.trim())) saveSettings();
  else status("That isn't a Spotify playlist or album link.");
};

/* ---------- Wiring ---------- */
/* Press to take a tile; press and drag to lift it and preview what it uncovers.
   Releasing after a drag snaps the tile back without taking it. */
const DRAG_THRESHOLD = 8;
let drag = null;
$("board").addEventListener("pointerdown", e => {
  const el = e.target.closest(".tile");
  if (!el || e.button > 0 || gameOver) return;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  drag = { el, id: +el.dataset.id, x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, z: el.style.zIndex, peeked: [] };
});
$("board").addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    drag.el.classList.remove("snap");
    drag.el.classList.add("dragging");
    drag.el.style.zIndex = 999999;
    // tiles that would become free if this one were gone
    const alive = aliveSet();
    const without = new Set(alive); without.delete(drag.id);
    for (const t of tiles) {
      if (!t.alive || t.id === drag.id) continue;
      if (!freeWith(t, alive) && freeWith(t, without)) {
        const el = document.querySelector(`.tile[data-id="${t.id}"]`);
        if (el) { el.classList.add("peek"); drag.peeked.push(el); }
      }
    }
  }
  drag.el.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`;
});
function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    if (!cancelled) clickTile(d.id);
    return;
  }
  d.el.classList.remove("dragging");
  d.el.classList.add("snap");
  d.el.style.transform = "";
  d.peeked.forEach(el => el.classList.remove("peek"));
  setTimeout(() => { d.el.classList.remove("snap"); d.el.style.zIndex = d.z; }, 220);
}
$("board").addEventListener("pointerup", e => endDrag(e, false));
$("board").addEventListener("pointercancel", e => endDrag(e, true));
$("board").addEventListener("dragstart", e => e.preventDefault());
$("board").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest(".tile"); if (el) { e.preventDefault(); clickTile(+el.dataset.id); }
});

/* Layout menu + imported layouts */
const CUSTOM_KEY = "metal-mahjong-custom-layouts";
function addLayoutOption(name) {
  const o = document.createElement("option");
  o.value = o.textContent = name;
  $("layoutSel").appendChild(o);
}
Object.keys(LAYOUTS).forEach(addLayoutOption);
let customLayouts = [];
try { customLayouts = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); } catch (_) {}
for (const c of customLayouts) {
  try { parseKmahjongg(c.text); LAYOUTS[c.name] = () => parseKmahjongg(c.text); addLayoutOption(c.name); } catch (_) {}
}
{ const any = document.createElement("option"); any.value = "*"; any.textContent = "Any layout"; $("layoutSel").appendChild(any); }
$("btnImport").onclick = () => { $("importErr").textContent = ""; $("importDlg").showModal(); };
$("importAdd").onclick = e => {
  const name = $("importName").value.trim(), text = $("importText").value;
  if (!name || !text.trim()) return;
  e.preventDefault();
  try {
    const t = parseKmahjongg(text);
    for (const p of t) for (const q of t)
      if (p !== q && p.z === q.z && overlap(p, q)) throw new Error("Two tiles overlap on the same level");
    if (t.length < 4) throw new Error("A layout needs at least 4 tiles");
    const isNew = !LAYOUTS[name];
    LAYOUTS[name] = () => parseKmahjongg(text);
    if (isNew) addLayoutOption(name);
    customLayouts = customLayouts.filter(c => c.name !== name).concat({ name, text });
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customLayouts)); } catch (_) {}
    $("importDlg").close();
    $("layoutSel").value = name;
    saveSettings();
    newGame();
  } catch (err) { $("importErr").textContent = err.message; }
};

/* Category + decade menus */
const MIN_ALBUMS = 6;
for (const [k, v] of Object.entries(GENRES)) $("genreSel").add(new Option(v.label, k));
function updateDecadeOptions() {
  const genre = $("genreSel").value;
  $("decadeSel").replaceChildren();
  for (const k of DECADE_ORDER) {
    const v = DECADES[k];
    const n = k === "all" ? 1 : catalogFor(genre, k).length;
    const o = new Option(n ? v.label : `${v.label} (none)`, k);
    o.disabled = !n;
    $("decadeSel").add(o);
  }
}
const filterLabel = () => {
  const g = $("genreSel").value, dd = $("decadeSel").value;
  if (g === "all" && dd === "all") return "";
  return [g === "all" ? "" : GENRES[g].label, dd === "all" ? "" : DECADES[dd].label].filter(Boolean).join(", ");
};

/* Settings (remembered between sessions) */
const SETTINGS_KEY = "metal-mahjong-settings";
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      genre: $("genreSel").value, decade: $("decadeSel").value, size: $("sizeSel").value, copies: $("copiesSel").value, side: $("sideBlock").checked, autoDelay: $("autoPick").value, layout: $("layoutSel").value,
      diff: $("diffSel").value, music: $("musSource").value, spotify: $("spotifyUrl").value.trim()
    }));
  } catch (_) {}
}
try {
  const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  if (s.copies) $("copiesSel").value = s.copies;
  if (s.size) $("sizeSel").value = s.size;
  if (s.genre && GENRES[s.genre]) $("genreSel").value = s.genre;
  updateDecadeOptions();
  if (s.decade && DECADES[s.decade] && catalogFor($("genreSel").value, s.decade).length) $("decadeSel").value = s.decade;
  if (s.diff) $("diffSel").value = s.diff;
  if (typeof s.side === "boolean") $("sideBlock").checked = s.side;
  if (s.autoDelay && [...$("autoPick").options].some(o => o.value === s.autoDelay)) $("autoPick").value = s.autoDelay;
  if (s.layout && [...$("layoutSel").options].some(o => o.value === s.layout)) $("layoutSel").value = s.layout;
  if (s.spotify) { $("spotifyUrl").value = s.spotify; spotifyEmbed(s.spotify); }
  if (s.music && [...$("musSource").options].some(o => o.value === s.music)) $("musSource").value = s.music;
} catch (_) {}
if (!$("decadeSel").options.length) updateDecadeOptions();
SIDE_BLOCKING = $("sideBlock").checked;
showMusicSource();

/* Game settings are staged: changing one doesn't deal a new board until Start is pressed. */
let pendingStart = false;
function markPending() {
  pendingStart = true;
  saveSettings();
  $("btnStart").classList.add("pending");
  $("btnStart").textContent = "▶ Start with these settings";
  status("Settings changed. Press Start to deal a new board.");
}
function startGame() {
  pendingStart = false;
  $("btnStart").classList.remove("pending");
  $("btnStart").textContent = "▶ Start game";
  SIDE_BLOCKING = $("sideBlock").checked;        // rule changes only take effect on a new deal
  boot();                                        // reloads the album pool if category/decade/size changed (cached otherwise)
}
$("btnStart").onclick = startGame;
$("layoutSel").onchange = markPending;
$("sizeSel").onchange = markPending;
$("genreSel").onchange = () => {
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").decade; } catch (_) {}
  updateDecadeOptions();                           // falls back to "All decades" if the old decade has nothing
  if (prev && prev !== "all" && catalogFor($("genreSel").value, prev).length) $("decadeSel").value = prev;
  markPending();
};
$("decadeSel").onchange = markPending;
/* Phone: every option lives in a menu under the ☰ button, so the tray and board get the screen. */
function setMenuOpen(open) {
  $("menuPanel").classList.toggle("open", open);
  $("menuBtn").setAttribute("aria-expanded", open);
  $("menuBtn").textContent = open ? "✕" : "☰";
}
$("menuBtn").onclick = () => setMenuOpen(!$("menuPanel").classList.contains("open"));
if (isPhone()) {
  $("menuPanel").appendChild(document.querySelector(".music"));
  $("settingsBox").appendChild($("btnReload"));
  // close when you touch the board, anywhere outside the menu, or after an action button
  document.addEventListener("pointerdown", e => {
    if (!e.target.closest("#menuPanel, #menuBtn")) setMenuOpen(false);
  }, { capture: true });
  ["btnNew", "btnHint", "btnShuffle", "btnUndo", "btnStart"].forEach(id => $(id).addEventListener("click", () => setMenuOpen(false)));
}
let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { applyWide(); autoFit(); }, 120);
});
$("copiesSel").onchange = markPending;
$("diffSel").onchange = markPending;
$("sideBlock").onchange = markPending;
$("autoPick").onchange = () => { saveSettings(); resetAuto(); };
$("btnNew").onclick = () => (pendingStart ? startGame() : newGame());
$("btnOverlayNew").onclick = () => (pendingStart ? startGame() : newGame());
$("btnOverlayUndo").onclick = undo;
$("btnHint").onclick = hint;
$("btnShuffle").onclick = reshuffle;
$("btnUndo").onclick = undo;
$("btnReload").onclick = () => { coverHealth.ok.clear(); coverHealth.failed.clear(); coverHealth.warned = false; boot(true); };
$("zoomIn").onclick = () => setZoom(zoom + .1);
$("zoomOut").onclick = () => setZoom(zoom - .1);
$("zoomFit").onclick = () => autoFit();

let bootId = 0;
async function boot(force = false) {
  const my = ++bootId;
  applyBoardSize();
  const genre = $("genreSel").value, decade = $("decadeSel").value;
  const need = SMALL_BOARD ? 32 : FACES_NEEDED;
  document.querySelectorAll("#menuPanel button, #menuPanel select").forEach(b => b.disabled = true);
  try {
    const pool = await loadPool(genre, decade, need, force);
    if (my !== bootId) return;                    // the filter changed while loading
    if (pool.length < MIN_ALBUMS) {
      status(`Only ${pool.length} albums with cover art for ${filterLabel() || "this filter"}. Pick another category or decade.`);
      return;
    }
    covers = pool;
    newGame();
    const pairsPerAlbum = +$("copiesSel").value / 2;
    if (pool.length * pairsPerAlbum < tiles.length / 2)
      status(`Only ${pool.length} albums for ${filterLabel() || "this filter"}, so some repeat on this board.`);
  } catch (e) {
    console.error(e);
    status(`Couldn't load covers (${e.message}). Use Reload covers to try again.`);
  } finally {
    if (my === bootId) {
      document.querySelectorAll("#menuPanel button, #menuPanel select").forEach(b => b.disabled = false);
      $("btnUndo").disabled = !history.length;
    }
  }
}
renderTray();
boot();
</script>
</body>
</html>
