// Layout + dealing checks (no browser). Usage: node tests/layouts.test.mjs
// Verifies every layout: no same-level overlaps, upper tiles fully or (random stack) at least
// half supported, even tile counts, and that tray-aware dealing always finds a winnable deal.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const L = new Function(readFileSync(join(root, "src", "layouts.js"), "utf8") +
  "; return { LAYOUTS, finalizeLayout, buildGeom, assignWithTray, overlap, support, setSmall: v => SMALL_BOARD = v, setSide: v => SIDE_BLOCKING = v };")();

let failed = 0;
const fail = msg => { failed++; console.log("FAIL " + msg); };
for (const small of [false, true]) {
  L.setSmall(small);
  for (const name of Object.keys(L.LAYOUTS)) {
    if (small && name !== "Random stack") continue;
    for (let k = 0; k < (name.includes("Random") || name === "Generated" ? 30 : 3); k++) {
      const t = L.finalizeLayout(L.LAYOUTS[name](), true);
      if (t.length % 2) fail(`${name}: odd tile count`);
      for (const a of t) for (const b of t) if (a !== b && a.z === b.z && L.overlap(a, b)) { fail(`${name}: overlap`); break; }
      const minSupport = name === "Random stack" ? 2 : 4;
      if (t.some(p => p.z > 0 && L.support(p, t) < minSupport)) fail(`${name}: unsupported tile`);
      if (small && (t.length < 36 || t.length > 64)) fail(`small board size ${t.length}`);
      const g = L.buildGeom(t), pairs = Array.from({ length: t.length / 2 }, (_, i) => i);
      for (const side of [true, false]) {
        L.setSide(side);
        if (!L.assignWithTray(g, g.map(x => x.id), pairs, [], 0.9)) fail(`${name}: no winnable deal (side=${side})`);
      }
    }
    console.log(`checked ${small ? "small " : ""}${name}`);
  }
}
console.log(failed ? `${failed} failure(s)` : "All layout checks passed");
process.exit(failed ? 1 : 0);
