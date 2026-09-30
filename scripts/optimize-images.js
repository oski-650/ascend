/**
 * Re-encodes oversized raster images in public/img in place.
 *
 * Many images are served raw (CSS backgrounds, BackgroundParallax, Blogs cards)
 * and bypass next/image, so the source files themselves must be web-sized.
 *
 * Usage: node scripts/optimize-images.js [--min-kb=200]
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..", "public", "img");
const MIN_KB = Number((process.argv.find((a) => a.startsWith("--min-kb=")) || "=200").split("=")[1]);
const MAX_DIM = 2400; // enough for full-width retina sections
const AVATAR_MAX_DIM = 600; // avatars render at ≤300 CSS px

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );

(async () => {
  let before = 0;
  let after = 0;
  for (const file of walk(ROOT)) {
    const ext = path.extname(file).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
    const size = fs.statSync(file).size;
    if (size < MIN_KB * 1024) continue;

    const maxDim = file.includes(`${path.sep}avatars${path.sep}`) ? AVATAR_MAX_DIM : MAX_DIM;
    let pipeline = sharp(file).rotate().resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true });
    if (ext === ".webp") pipeline = pipeline.webp({ quality: 80, effort: 5 });
    else if (ext === ".png") pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality: 85 });
    else pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true, progressive: true });

    const out = await pipeline.toBuffer();
    before += size;
    if (out.length < size) {
      fs.writeFileSync(file, out);
      after += out.length;
      console.log(`${(size / 1024).toFixed(0).padStart(6)} KB -> ${(out.length / 1024).toFixed(0).padStart(5)} KB  ${path.relative(ROOT, file)}`);
    } else {
      after += size;
    }
  }
  console.log(`\nTotal: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
})();
