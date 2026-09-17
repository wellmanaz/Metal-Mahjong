#!/usr/bin/env node
// Looks up every CATALOG row on MusicBrainz and the Cover Art Archive and writes
// the results back onto the row (mbid | mbYear | cover), so the game never has to
// query MusicBrainz in the browser.
//
// Usage:
//   node tools/precompute.mjs            # only rows missing data
//   node tools/precompute.mjs --all      # recheck every row
//   node tools/precompute.mjs --covers   # recheck cover flags only (keeps ids)
// Then: node tools/build.mjs
//
// Requires Node 18+ (global fetch). Respects MusicBrainz's 1 request/second limit
// and sends an identifying User-Agent, as their API guidelines ask.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "src", "catalog.js");
const UA = "MetalMahjong/1.0 ( https://wellmanaz.github.io/Metal-Mahjong/ )";
const ALL = process.argv.includes("--all");
const COVERS_ONLY = process.argv.includes("--covers");

const src = readFileSync(file, "utf8");
const start = src.indexOf("const CATALOG_TEXT = `") + "const CATALOG_TEXT = `".length;
const end = src.indexOf("`;", start);
const lines = src.slice(start, end).trim().split("\n");
const rows = lines.map(l => {
  const [year, genres, artist, title, id, mbYear, cover] = l.split("|");
  return { year, genres, artist, title, id, mbYear, cover };
});

const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => s.replace(/[\\"]/g, m => "\\" + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const creditName = rg => (rg["artist-credit"] || []).map(c => c.name + (c.joinphrase || "")).join("");
const isStudioAlbum = rg => rg["primary-type"] === "Album" && !(rg["secondary-types"] || []).length;

// Must stay identical to matchReleaseGroup() in src/loader.js.
function match(results, a) {
  const nt = norm(a.title), na = norm(a.artist);
  return results
    .filter(rg => {
      const rt = norm(rg.title);
      const titleOk = rt === nt || (nt.length >= 8 && rt.startsWith(nt) && rt.length - nt.length <= 4);
      return isStudioAlbum(rg) && titleOk && norm(creditName(rg)).includes(na);
    })
    .sort((x, y) => (y.score || 0) - (x.score || 0))[0];
}

let last = 0;
async function mb(query) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=100`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 503) { await sleep(3000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`MusicBrainz ${r.status}`);
    return (await r.json())["release-groups"] || [];
  }
  throw new Error("MusicBrainz kept returning 503");
}

async function hasFrontCover(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://coverartarchive.org/release-group/${id}`, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (r.status === 404) return false;
      if (!r.ok) throw new Error(`CAA ${r.status}`);
      const j = await r.json();
      return (j.images || []).some(img => img.front);
    } catch (e) { await sleep(2000); }
  }
  return false;
}

const todo = COVERS_ONLY ? [] : rows.filter(r => ALL || !r.id);
console.log(`${rows.length} catalog rows, ${todo.length} to look up on MusicBrainz`);
for (let i = 0; i < todo.length; i += 15) {
  const batch = todo.slice(i, i + 15);
  const q = batch.map(a => `(artist:"${esc(a.artist)}" AND releasegroup:"${esc(a.title)}")`).join(" OR ");
  const results = await mb(`(${q}) AND primarytype:album`);
  for (const a of batch) {
    const hit = match(results, a);
    if (hit) { a.id = hit.id; a.mbYear = (hit["first-release-date"] || "").slice(0, 4) || a.year; a.cover = undefined; }
    // Hand-filled rows (title differs from MusicBrainz's on purpose) keep their id on --all.
    else if (a.id && a.id !== "-") console.log(`\n  kept existing id: ${a.artist} — ${a.title}`);
    else { a.id = "-"; a.mbYear = ""; a.cover = ""; console.log(`\n  no match: ${a.artist} — ${a.title}`); }
  }
  process.stdout.write(`\r  looked up ${Math.min(i + 15, todo.length)}/${todo.length}`);
}
if (todo.length) process.stdout.write("\n");

const needCover = rows.filter(r => r.id && r.id !== "-" && (COVERS_ONLY || ALL || r.cover === undefined || r.cover === ""));
console.log(`checking ${needCover.length} covers`);
for (let i = 0; i < needCover.length; i += 4) {
  const chunk = needCover.slice(i, i + 4);
  const flags = await Promise.all(chunk.map(r => hasFrontCover(r.id)));
  chunk.forEach((r, j) => r.cover = flags[j] ? "1" : "0");
  process.stdout.write(`\r  checked ${Math.min(i + 4, needCover.length)}/${needCover.length}`);
}
if (needCover.length) process.stdout.write("\n");

const outLines = rows.map(r => {
  const base = [r.year, r.genres, r.artist, r.title];
  if (!r.id) return base.join("|");
  if (r.id === "-") return [...base, "-", "", ""].join("|");
  return [...base, r.id, r.mbYear, r.cover].join("|");
});
writeFileSync(file, src.slice(0, start) + "\n" + outLines.join("\n") + "\n" + src.slice(end));
const missing = rows.filter(r => r.id === "-").length, noCover = rows.filter(r => r.cover === "0").length;
console.log(`done: ${rows.length - missing} matched, ${missing} unmatched, ${noCover} without cover art`);
