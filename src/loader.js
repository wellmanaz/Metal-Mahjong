
/* ---------- Album pool ---------- */
const FACES_NEEDED = 72;  // enough for every tile pair on a 144-tile board to be a different album
const MB = "https://musicbrainz.org/ws/2/release-group/";
const coverUrl = (id, size = 250) => `https://coverartarchive.org/release-group/${id}/front-${size}`;
const $ = id => document.getElementById(id);
const status = msg => { $("status").textContent = msg; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => s.replace(/[\\"]/g, m => "\\" + m);

let lastMbCall = 0;
async function mbFetch(query, limit = 100) {
  const wait = 1100 - (Date.now() - lastMbCall);       // MusicBrainz: max 1 req/sec
  if (wait > 0) await sleep(wait);
  lastMbCall = Date.now();
  const url = `${MB}?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
  return (await res.json())["release-groups"] || [];
}

const creditName = rg => (rg["artist-credit"] || []).map(c => c.name + (c.joinphrase || "")).join("");
const toEntry = rg => ({ id: rg.id, artist: creditName(rg), title: rg.title, year: (rg["first-release-date"] || "").slice(0, 4) });
const isStudioAlbum = rg => rg["primary-type"] === "Album" && !(rg["secondary-types"] || []).length;

function probeImage(src, timeout = 10000) {
  return new Promise(resolve => {
    const img = new Image();
    const t = setTimeout(() => { img.src = ""; resolve(false); }, timeout);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = src;
  });
}


/* ---------- Album pool by genre + decade ----------
   Every catalog album's MusicBrainz release-group ID, release year and
   cover-art availability are precomputed (tools/precompute.mjs) and stored on
   its CATALOG row, so normal play makes no MusicBrainz requests at all.
   resolveCatalog() only runs for catalog rows that have no precomputed data
   (e.g. albums added to the catalog without re-running the precompute step). */
const ALBUM_CACHE_KEY = "metal-mahjong-albums-v4";
let albumCache = {};
try { albumCache = JSON.parse(localStorage.getItem(ALBUM_CACHE_KEY) || "{}"); } catch (_) {}
function saveCaches() {
  try { localStorage.setItem(ALBUM_CACHE_KEY, JSON.stringify(albumCache)); } catch (_) {}
}
const ckey = a => `${a.artist}|${a.title}`;
const inDecade = (year, d) => year >= DECADES[d].from && year <= DECADES[d].to;
const catalogFor = (genre, decade) =>
  CATALOG.filter(a => (genre === "all" || a.genres.includes(genre)) && inDecade(a.year, decade));

/* Precomputed rows win over anything cached locally, except a cover that has
   since been confirmed missing in this browser. */
function seedFromPrecomputed() {
  for (const a of CATALOG) {
    if (a.pre === undefined) continue;             // no precomputed data for this row
    const k = ckey(a);
    if (a.pre === null) { albumCache[k] = 0; continue; }
    const prev = albumCache[k];
    albumCache[k] = {
      id: a.pre.id, artist: a.artist, title: a.title, year: a.pre.year || String(a.year),
      cover: prev && prev.id === a.pre.id && prev.cover === false ? false : a.pre.cover,
    };
  }
}

async function probeAll(entries, quiet) {
  const todo = entries.filter(e => e.cover === undefined);
  for (let i = 0; i < todo.length; i += 12) {
    if (!quiet) status(`Checking Cover Art Archive… ${Math.min(i + 12, todo.length)}/${todo.length}`);
    const chunk = todo.slice(i, i + 12);
    const flags = await Promise.all(chunk.map(e => probeImage(coverUrl(e.id))));
    chunk.forEach((e, j) => e.cover = flags[j]);
  }
}

async function resolveCatalog(list, quiet = false) {
  const BATCH = 15;
  const fresh = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    if (!quiet) status(`Looking up albums on MusicBrainz… ${Math.min(i + BATCH, list.length)}/${list.length}`);
    const q = batch.map(a => `(artist:"${esc(a.artist)}" AND releasegroup:"${esc(a.title)}")`).join(" OR ");
    let results;
    try { results = await mbFetch(`(${q}) AND primarytype:album`); }
    catch (e) { console.warn(e); continue; }          // network trouble: leave uncached so it's retried
    for (const a of batch) {
      const hit = matchReleaseGroup(results, a);
      if (hit) {
        const e = { id: hit.id, artist: a.artist, title: a.title, year: (hit["first-release-date"] || "").slice(0, 4) || String(a.year) };
        albumCache[ckey(a)] = e;
        fresh.push(e);
      } else albumCache[ckey(a)] = 0;
    }
  }
  await probeAll(fresh, quiet);
  saveCaches();
}

/* Same matching rule the precompute tool uses. */
function matchReleaseGroup(results, a) {
  const nt = norm(a.title), na = norm(a.artist);
  return results
    .filter(rg => {
      const rt = norm(rg.title);
      const titleOk = rt === nt || (nt.length >= 8 && rt.startsWith(nt) && rt.length - nt.length <= 4);
      return isStudioAlbum(rg) && titleOk && norm(creditName(rg)).includes(na);
    })
    .sort((x, y) => (y.score || 0) - (x.score || 0))[0];
}

async function loadPool(genre, decade, need, force = false) {
  const cands = shuffleArr(catalogFor(genre, decade));
  if (force) {
    // "Reload covers": forget this browser's missing-cover verdicts and check them again
    const recheck = cands.map(a => albumCache[ckey(a)]).filter(e => e && e.cover === false);
    recheck.forEach(e => e.cover = undefined);
    await probeAll(recheck);
    saveCaches();
  }
  // Only rows without precomputed data hit MusicBrainz; cap it so a filter never waits minutes.
  const have = cands.filter(a => { const e = albumCache[ckey(a)]; return e && e.cover !== false; }).length;
  const unresolved = cands.filter(a => !(ckey(a) in albumCache));
  const take = unresolved.slice(0, Math.max(0, Math.ceil((need - have) * 1.4) + 8));
  if (take.length) await resolveCatalog(take);
  return cands
    .map(a => albumCache[ckey(a)])
    .filter(e => e && e.cover && inDecade(parseInt(e.year, 10) || 0, decade));
}
