#!/usr/bin/env node
// Concatenates src/ into the single self-contained index.html that GitHub Pages serves.
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Order matters: later files use globals declared by earlier ones at load time.
const parts = ["head.html", "loader.js", "catalog.js", "layouts.js", "game.js"];
const out = parts.map(p => readFileSync(join(root, "src", p), "utf8")).join("");
if (!out.includes("<script>") || !out.trimEnd().endsWith("</html>")) {
  throw new Error("src/head.html must open <script> and src/game.js must close </script></body></html>");
}
// Fail fast on syntax errors in the combined script.
new Function(out.split("<script>")[1].split("</script>")[0]);
writeFileSync(join(root, "index.html"), out);
console.log(`index.html written (${out.length.toLocaleString()} bytes)`);
