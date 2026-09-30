/**
 * Builds public/css/plugins.slim.min.css from the vendor plugins.min.css,
 * dropping the Phosphor icon weights the site never uses (Duotone, Light, Thin).
 * Each weight adds ~85–230KB of icon class rules to the render-blocking CSS.
 *
 * The vendor file is left untouched. Re-run after replacing plugins.min.css:
 *   node scripts/slim-plugins-css.js
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "public", "css");
const UNUSED = new Set(["Phosphor-Duotone", "Phosphor-Light", "Phosphor-Thin"]);

const css = fs.readFileSync(path.join(DIR, "plugins.min.css"), "utf8");

// The icon sets are laid out as: @font-face { font-family: X } + all X rules,
// up to the next @font-face. Split on those boundaries and drop unused sets.
const starts = [...css.matchAll(/@font-face/g)].map((m) => m.index);
let out = css.slice(0, starts[0]);
starts.forEach((start, i) => {
  const end = i + 1 < starts.length ? starts[i + 1] : css.length;
  const family = /@font-face\s*\{\s*font-family:\s*"?([^";]+)/.exec(css.slice(start))[1];
  if (!UNUSED.has(family)) out += css.slice(start, end);
});

fs.writeFileSync(path.join(DIR, "plugins.slim.min.css"), out);
console.log(`plugins.min.css ${(css.length / 1024).toFixed(0)}KB -> plugins.slim.min.css ${(out.length / 1024).toFixed(0)}KB`);
