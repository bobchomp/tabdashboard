#!/usr/bin/env node
// Interactive one-shot release: asks for your Firefox Add-ons (AMO) API
// key/secret, signs the extension, copies the signed build into
// download-site/, then commits and pushes that to GitHub so Vercel
// redeploys the download page. Run with: npm run release

const { spawnSync } = require("child_process");
const readline = require("readline");
const path = require("path");
const fs = require("fs");

const repoRoot = path.join(__dirname, "..");

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Prompts without echoing what's typed, for the API secret. Reads raw
// bytes (rather than decoded text) so control characters like Enter,
// Backspace, and Ctrl-C can be matched by numeric code, rather than by
// embedding literal control bytes in this file's source.
function askHidden(query) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(query);

    const isTTY = !!stdin.isTTY;
    const wasRaw = stdin.isRaw;
    if (isTTY) stdin.setRawMode(true);
    stdin.resume();

    const ENTER_CODES = [10, 13];
    const CTRL_C = 3;
    const BACKSPACE_CODES = [8, 127];

    let input = "";

    function finish(value) {
      if (isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value);
    }

    // Handles multiple bytes arriving in a single chunk (e.g. a pasted
    // secret, or fast typing) rather than only ever looking at the first
    // byte — otherwise a pasted value silently gets mangled.
    function onData(chunk) {
      let printable = [];
      const flushPrintable = () => {
        if (!printable.length) return;
        const text = Buffer.from(printable).toString("utf8");
        input += text;
        process.stdout.write("*".repeat(text.length));
        printable = [];
      };

      for (let i = 0; i < chunk.length; i++) {
        const code = chunk[i];

        if (ENTER_CODES.includes(code)) {
          flushPrintable();
          finish(input.trim());
          return;
        }
        if (code === CTRL_C) {
          flushPrintable();
          process.stdout.write("\n");
          process.exit(1);
        }
        if (BACKSPACE_CODES.includes(code)) {
          flushPrintable();
          if (input.length) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        printable.push(code);
      }
      flushPrintable();
    }
    stdin.on("data", onData);
  });
}

function run(cmd, args, { env = {}, useShell = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: useShell,
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.error(`\nFailed to run "${cmd}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n"${cmd} ${args.join(" ")}" exited with code ${result.status}.`);
    process.exit(result.status || 1);
  }
}

function runCapture(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
  return (result.stdout || "").trim();
}

// AMO rejects a signing submission that reuses a version number already
// submitted, so each release needs a fresh one. Bumps the patch number in
// manifest.json with a targeted regex replace (rather than
// JSON.parse/stringify) so the file's formatting is left untouched.
function bumpPatchVersion() {
  const manifestPath = path.join(repoRoot, "manifest.json");
  const text = fs.readFileSync(manifestPath, "utf8");
  const match = text.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/);
  if (!match) {
    console.error('Could not find a "version": "X.Y.Z" field in manifest.json — aborting.');
    process.exit(1);
  }
  const [full, major, minor, patch] = match;
  const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;
  const updated = text.replace(full, `"version": "${nextVersion}"`);
  fs.writeFileSync(manifestPath, updated);
  return nextVersion;
}

async function main() {
  console.log("== New Tab Dashboard: sign, publish, and push ==\n");
  console.log("Get a free API key/secret at https://addons.mozilla.org/developers/addon/api/key/");
  console.log("if you don't already have one handy.\n");

  const apiKey = await ask("Firefox Add-ons API key (looks like user:12345:678): ");
  if (!apiKey) {
    console.error("No API key entered — aborting.");
    process.exit(1);
  }

  const apiSecret = await askHidden("Firefox Add-ons API secret (hidden as you type): ");
  if (!apiSecret) {
    console.error("No API secret entered — aborting.");
    process.exit(1);
  }

  const version = bumpPatchVersion();
  console.log(`\nBumped manifest.json to v${version}.`);

  console.log("\n-- Signing with Mozilla --");
  run("npx", ["web-ext", "sign", "--channel=unlisted"], {
    env: { WEB_EXT_API_KEY: apiKey, WEB_EXT_API_SECRET: apiSecret },
    useShell: true,
  });

  console.log("\n-- Copying the signed build into download-site/ --");
  run("node", ["scripts/publish-download.js"]);

  console.log("\n-- Committing and pushing --");
  run("git", ["add", "download-site", "manifest.json"]);

  const staged = runCapture("git", ["diff", "--cached", "--name-only"]);
  if (!staged) {
    console.log("Nothing changed in download-site/ (identical to what's already published) — skipping commit/push.");
    return;
  }

  run("git", ["commit", "-m", `Publish v${version}`]);

  const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  run("git", ["push", "-u", "origin", branch]);

  console.log(`\nDone. Published v${version} and pushed to origin/${branch}.`);
  console.log("Vercel will redeploy the download page automatically if it's connected to this repo.");
}

main();
