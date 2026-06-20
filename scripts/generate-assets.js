/**
 * Renders all Lincoln brand assets (PNG + SVG) into ./assets.
 * Run with:  node scripts/generate-assets.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const b = require("./brand");

const OUT = path.join(__dirname, "..", "assets");
fs.mkdirSync(OUT, { recursive: true });

async function png(svg, file, size) {
  const buf = Buffer.from(svg);
  let img = sharp(buf, { density: 384 });
  if (size) img = img.resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await img.png().toFile(path.join(OUT, file));
  console.log("✓", file);
}

async function pngSize(svg, file, w, h) {
  await sharp(Buffer.from(svg), { density: 200 }).resize(w, h).png().toFile(path.join(OUT, file));
  console.log("✓", file);
}

(async () => {
  // App icon (full bleed, 1024)
  await png(b.iconSquare({ size: 1024 }), "icon.png", 1024);

  // Android adaptive icon — transparent foreground (background is a solid
  // brand color set in app.json -> android.adaptiveIcon.backgroundColor)
  await png(b.adaptiveForeground({ size: 1024 }), "adaptive-icon.png", 1024);

  // Splash screen
  await pngSize(b.splash({ width: 1242, height: 2688 }), "splash.png", 1242, 2688);

  // Web favicon
  await png(b.iconSquare({ size: 256 }), "favicon.png", 256);

  // Vector sources for the web / docs
  fs.writeFileSync(path.join(OUT, "logo-mark.svg"), b.iconSquare({ size: 512 }));
  fs.writeFileSync(path.join(OUT, "logo-wordmark.svg"), b.wordmark());
  console.log("✓ logo-mark.svg, logo-wordmark.svg");

  console.log("\nAll brand assets generated in /assets");
})();
