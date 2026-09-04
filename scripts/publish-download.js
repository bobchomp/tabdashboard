#!/usr/bin/env node
// Copies the most recently signed .xpi from web-ext-artifacts/ into
// download-site/latest/, under a stable filename, and writes a small
// version.json alongside it. Run this after `npm run sign` (or use
// `npm run release`, which does both). Commit + push the result to deploy
// the new build to the download site.

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const artifactsDir = path.join(repoRoot, "web-ext-artifacts");
const destDir = path.join(repoRoot, "download-site", "latest");
const destXpi = path.join(destDir, "tabdashboard.xpi");
const destVersionJson = path.join(destDir, "version.json");
const manifestPath = path.join(repoRoot, "manifest.json");

function fail(message) {
  console.error(`[publish-download] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(artifactsDir)) {
  fail(`No web-ext-artifacts/ folder found. Run "npm run sign" first.`);
}

const xpiFiles = fs
  .readdirSync(artifactsDir)
  .filter((name) => name.endsWith(".xpi"))
  .map((name) => {
    const full = path.join(artifactsDir, name);
    return { name, full, mtime: fs.statSync(full).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime);

if (!xpiFiles.length) {
  fail(`No .xpi files found in web-ext-artifacts/. Run "npm run sign" first.`);
}

const latest = xpiFiles[0];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(latest.full, destXpi);
fs.writeFileSync(
  destVersionJson,
  JSON.stringify({ version: manifest.version, publishedAt: new Date().toISOString() }, null, 2) + "\n"
);

console.log(`[publish-download] Copied ${latest.name} -> download-site/latest/tabdashboard.xpi`);
console.log(`[publish-download] Wrote version ${manifest.version} to download-site/latest/version.json`);
console.log(`[publish-download] Next: git add download-site && git commit -m "Publish v${manifest.version}" && git push`);
