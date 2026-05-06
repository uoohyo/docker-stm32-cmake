#!/usr/bin/env node
/**
 * Scrape all STM32CubeCLT-Lnx versions from ST website using a headless browser.
 *
 * Strategy:
 *   1. Launch Puppeteer (Chrome network stack — passes ST's TLS/IP checks).
 *   2. Intercept the sw-versions-nli.html response that the page loads either
 *      during initial load or after the "Select version" button is clicked.
 *      This fragment contains every available release in its HTML.
 *   3. Parse versions from data-reg-required-link-path attributes:
 *        product=STM32CubeCLT-Lnx.version=X.Y.Z.html
 *   4. Retry up to MAX_RETRIES times (fresh browser per attempt).
 *
 * Why Puppeteer: plain Node.js fetch is rejected by ST's servers in CI
 * (data-center IP ranges / TLS fingerprinting). Chrome's network stack passes.
 * Response interception avoids any dependency on inline JS execution or DOM
 * manipulation, which were unreliable in headless environments.
 */

const puppeteer = require('puppeteer');

const ST_CUBECLT_PAGE = 'https://www.st.com/en/development-tools/stm32cubeclt.html';
const VERSIONS_URL_FRAGMENT = 'sw-versions-nli.html';
const MAX_RETRIES = 3;
const NAV_TIMEOUT = 120000;    // 2 min — initial page load
const CAPTURE_TIMEOUT = 60000; // 1 min — wait for sw-versions-nli response

// ---------------------------------------------------------------------------
// Single attempt
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

    // Capture the sw-versions-nli fragment via response interception.
    // This works regardless of when ST loads it (initial load or on button click).
    let resolveCapture;
    const capturePromise = new Promise((resolve, reject) => {
      resolveCapture = resolve;
      setTimeout(() => reject(new Error(`sw-versions-nli.html not received within ${CAPTURE_TIMEOUT / 1000}s`)), CAPTURE_TIMEOUT);
    });

    page.on('response', async (response) => {
      if (response.url().includes(VERSIONS_URL_FRAGMENT)) {
        try {
          const text = await response.text();
          console.error(`[Attempt ${attempt}] Captured sw-versions-nli response (${text.length} bytes)`);
          resolveCapture(text);
        } catch (e) {
          // redirect or body-read error — ignore, wait for the real response
        }
      }
    });

    console.error(`[Attempt ${attempt}] Navigating to ${ST_CUBECLT_PAGE}...`);
    await page.goto(ST_CUBECLT_PAGE, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

    // If sw-versions-nli wasn't loaded during initial page load, click the
    // "Select version" button to trigger it.
    const clicked = await page.evaluate(() => {
      const td = document.querySelector('[data-product-rpn="STM32CubeCLT-Lnx"]');
      const row = td && td.closest('tr');
      const btn = row && row.querySelector('.msw-selectversionbutton');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) console.error(`[Attempt ${attempt}] Select-version button clicked`);

    const html = await capturePromise;

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
