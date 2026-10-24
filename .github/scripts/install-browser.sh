#!/usr/bin/env bash
# Provision only the Chrome revision selected by the locked Puppeteer package.
set -euo pipefail
: "${PUPPETEER_CACHE_DIR:?Set a job-local PUPPETEER_CACHE_DIR for installation and launch}"
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
