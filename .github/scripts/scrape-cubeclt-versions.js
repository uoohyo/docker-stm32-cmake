#!/usr/bin/env node
/**
 * Scrape all STM32CubeCLT-Lnx versions from ST website using a headless browser.
 *
 * Strategy:
 *   1. Launch Puppeteer (Chrome network stack — passes ST's TLS/IP checks).
 *   2. Navigate directly to the sw-versions-nli.html fragment URL.
 *      This static HTML contains every available release.
 *   3. Parse versions from data-reg-required-link-path attributes:
 *        product=STM32CubeCLT-Lnx.version=X.Y.Z.html
 *   4. Retry up to MAX_RETRIES times (fresh browser per attempt).
 *
 * Why Puppeteer: plain Node.js fetch and sub-resource loading are both
 * rejected by ST's servers in CI (data-center IPs / TLS fingerprinting).
 * A direct Chrome navigation passes because it sends a full browser
 * TLS fingerprint and request-header set.
 */

const puppeteer = require('puppeteer');

const ST_VERSIONS_URL = 'https://www.st.com/content/st_com/en/products/development-tools/software-development-tools/stm32-software-development-tools/stm32-ides/stm32cubeclt.sw-versions-nli.html';
const MAX_RETRIES = 3;
const NAV_TIMEOUT = 120000; // 2 min

// ---------------------------------------------------------------------------
// Single attempt: navigate directly to the versions fragment URL
// ---------------------------------------------------------------------------
async function attemptScrape(attempt) {
  console.error(`[Attempt ${attempt}] Launching headless browser...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://www.st.com/en/development-tools/stm32cubeclt.html',
    });

    console.error(`[Attempt ${attempt}] Navigating to versions URL...`);
    const response = await page.goto(ST_VERSIONS_URL, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
    }

    const html = await response.text();
    console.error(`[Attempt ${attempt}] Received ${html.length} bytes`);

    const versions = [...new Set(
      [...html.matchAll(/product=STM32CubeCLT-Lnx\.version=(\d+\.\d+\.\d+)\.html/g)]
        .map(m => m[1])
    )];

    if (versions.length === 0) throw new Error('No STM32CubeCLT-Lnx versions found in response');

    console.error(`[Attempt ${attempt}] ✓ Found ${versions.length} versions`);
    return versions;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main: retry loop
// ---------------------------------------------------------------------------
async function scrapeVersions() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const versions = await attemptScrape(attempt);

      const versionList = versions.map(version => {
        const [major, minor, patch] = version.split('.').map(Number);
        return { version, major, minor, patch, linux_supported: true, requires_auth: true };
      });

      versionList.sort((a, b) => {
        for (const k of ['major', 'minor', 'patch']) {
          if (a[k] !== b[k]) return b[k] - a[k];
        }
        return 0;
      });

      versionList[0].is_latest = true;
      console.error(`Latest version: ${versionList[0].version}`);
      console.error(`Total versions: ${versionList.length}`);

      console.log(JSON.stringify(versionList));
      return;
    } catch (e) {
      lastError = e;
      console.error(`[Attempt ${attempt}] Failed: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 10000;
        console.error(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
