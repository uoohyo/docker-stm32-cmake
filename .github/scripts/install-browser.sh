#!/usr/bin/env bash
# Provision only the Chrome revision selected by the locked Puppeteer package.
set -euo pipefail
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${GITHUB_ENV:?GitHub job environment file is required}"
# mktemp avoids shared home caches and isolates concurrent jobs on one machine.
export PUPPETEER_CACHE_DIR="$(mktemp -d "${RUNNER_TEMP}/puppeteer.XXXXXXXX")"
printf 'PUPPETEER_CACHE_DIR=%s\n' "$PUPPETEER_CACHE_DIR" >> "$GITHUB_ENV"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Do not rely on the best-effort package postinstall hook or a shared home cache.
PUPPETEER_SKIP_DOWNLOAD=true npm ci --prefix "$SCRIPT_DIR" --ignore-scripts
node "$SCRIPT_DIR/node_modules/puppeteer/lib/puppeteer/node/cli.js" browsers install chrome
node - "$SCRIPT_DIR" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require(path.join(process.argv[2], 'node_modules/puppeteer'));
(async () => {
  const executable = await puppeteer.executablePath();
  fs.accessSync(executable, fs.constants.X_OK);
  console.log(`Verified Puppeteer Chrome executable: ${executable}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
