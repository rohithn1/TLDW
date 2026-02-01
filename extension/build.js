// Post-build: copy static assets to dist/
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "public");
const distDir = path.join(__dirname, "dist");

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy all files from public/ to dist/
if (fs.existsSync(publicDir)) {
  for (const file of fs.readdirSync(publicDir)) {
    fs.copyFileSync(path.join(publicDir, file), path.join(distDir, file));
  }
}

// Copy icons
const iconsDir = path.join(__dirname, "icons");
const distIconsDir = path.join(distDir, "icons");
if (fs.existsSync(iconsDir)) {
  if (!fs.existsSync(distIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
  }
  for (const file of fs.readdirSync(iconsDir)) {
    fs.copyFileSync(path.join(iconsDir, file), path.join(distIconsDir, file));
  }
}

console.log("Build complete: dist/");
