#!/usr/bin/env node
/**
 * Scrape all STM32CubeCLT-Lnx versions from ST website using a headless browser.
 *
 * Strategy:
 *   1. Navigate to the STM32CubeCLT product page (headless Chrome via Puppeteer).
 *   2. Wait for the get-software table SDI fragment to load.
 *   3. Click the "Select version" button in the STM32CubeCLT-Lnx row to trigger
 *      the inline scripts that populate data-software-release attributes.
 *   4. Extract all versions from the dropdown's gscontent elements.
 *   5. If the dropdown doesn't populate (CI environment / anti-bot), fall back to
 *      the HTTP approach which returns only the latest version.
 *
 * Why Puppeteer: ST's version list is rendered by inline <script> blocks that only
 * execute after the page's get-software JS initialises them. A plain HTTP fetch only
 * returns the latest version; the full dropdown requires JavaScript execution.
 */

const puppeteer = require('puppeteer');

const ST_CUBECLT_PAGE = 'https://www.st.com/en/development-tools/stm32cubeclt.html';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// ---------------------------------------------------------------------------
// HTTP fallback: fetches only the latest version (no JS required)
// ---------------------------------------------------------------------------
async function fetchLatestVersionHttp() {
  const mainRes = await fetch(ST_CUBECLT_PAGE, { headers: HEADERS });
  if (!mainRes.ok) throw new Error(`HTTP ${mainRes.status} fetching main page`);
  const mainHtml = await mainRes.text();

  const match = mainHtml.match(/jQuery\.get\("([^"]*get-software-table-body[^"]*)"/);
  if (!match) throw new Error('Could not find get-software-table-body URL in main page');
  const tableUrl = 'https://www.st.com' + match[1].replace(/\\\//g, '/');

  const tableRes = await fetch(tableUrl, { headers: { ...HEADERS, 'Referer': ST_CUBECLT_PAGE } });
  if (!tableRes.ok) throw new Error(`HTTP ${tableRes.status} fetching table body`);
  const tableHtml = await tableRes.text();

  const trMatch = tableHtml.match(
    /<tr>\s*<td[^>]*data-product-rpn=["']STM32CubeCLT-Lnx["'][^>]*>[\s\S]*?<\/tr>/
  );
  if (trMatch) {
    const vMatch = trMatch[0].match(/<td>\s*(\d+\.\d+\.\d+)\s*<\/td>/);
    if (vMatch) return [vMatch[1]];
  }
  throw new Error('Could not extract version from get-software table');
}

// ---------------------------------------------------------------------------
// Main: Puppeteer with HTTP fallback
// ---------------------------------------------------------------------------
async function scrapeVersions() {
  let versions = null;

  console.error('Launching headless browser...');
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

    console.error(`Navigating to ${ST_CUBECLT_PAGE}...`);
    await page.goto(ST_CUBECLT_PAGE, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the SDI get-software table fragment to inject the product row
    console.error('Waiting for STM32CubeCLT-Lnx product row...');
    await page.waitForSelector('[data-product-rpn="STM32CubeCLT-Lnx"]', { timeout: 30000 });
    console.error('Product row found.');

    // Click the "Select version" button using a row-relative selector (no hardcoded IDs).
    // This triggers initSoftwareButtons which runs the inline scripts that
    // set data-software-release on each gscontent element in the dropdown.
    const clicked = await page.evaluate(() => {
      const td = document.querySelector('[data-product-rpn="STM32CubeCLT-Lnx"]');
      const row = td && td.closest('tr');
      const btn = row && row.querySelector('.msw-selectversionbutton');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.error(`Select-version button clicked: ${clicked}`);

    if (clicked) {
      // Wait up to 30 s for inline scripts to populate data-software-release.
      // Use a row-relative selector so no hardcoded product IDs are needed.
      try {
        await page.waitForFunction(
          () => {
            const td = document.querySelector('[data-product-rpn="STM32CubeCLT-Lnx"]');
            const row = td && td.closest('tr');
            const dropdown = row && row.querySelector('.msw-selectversionbutton-content');
            return dropdown && dropdown.querySelectorAll('.gscontent[data-software-release]').length > 0;
          },
          { timeout: 30000 }
        );

        versions = await page.evaluate(() => {
          const td = document.querySelector('[data-product-rpn="STM32CubeCLT-Lnx"]');
          const row = td.closest('tr');
          const dropdown = row.querySelector('.msw-selectversionbutton-content');
          return [...dropdown.querySelectorAll('.gscontent[data-software-release]')]
            .map(el => el.getAttribute('data-software-release'))
            .filter(v => /^\d+\.\d+\.\d+$/.test(v));
        });
        console.error(`✓ Dropdown populated: ${versions.length} versions`);
      } catch (e) {
        console.error(`Dropdown did not populate (${e.message}). Falling back to HTTP.`);
      }
    }
  } finally {
    await browser.close();
  }

  // HTTP fallback: get at least the latest version
  if (!versions || versions.length === 0) {
    console.error('Using HTTP fallback (latest version only)...');
    versions = await fetchLatestVersionHttp();
    console.error(`✓ HTTP fallback: got version ${versions[0]}`);
  }

  const unique = [...new Set(versions)];
  const versionList = unique.map(version => {
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
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
