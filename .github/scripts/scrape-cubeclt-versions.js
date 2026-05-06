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
 *
 * Why Puppeteer: ST's version list is rendered by inline <script> blocks that only
 * execute after the page's get-software JS initialises them. A plain HTTP fetch only
 * returns the latest version; the full dropdown requires JavaScript execution.
 */

const puppeteer = require('puppeteer');

const ST_CUBECLT_PAGE = 'https://www.st.com/en/development-tools/stm32cubeclt.html';

async function scrapeVersions() {
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

    // Click the "Select version" button in the STM32CubeCLT-Lnx row.
    // This triggers initSoftwareButtons which runs the inline scripts that
    // set data-software-release on each gscontent element in the dropdown.
    const clicked = await page.evaluate(() => {
      const td = document.querySelector('[data-product-rpn="STM32CubeCLT-Lnx"]');
      const row = td && td.closest('tr');
      const btn = row && row.querySelector('.msw-selectversionbutton');
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (!clicked) {
      throw new Error(
        'Could not find the "Select version" button for STM32CubeCLT-Lnx. ' +
        'The page structure may have changed.'
      );
    }

    // Wait until the inline scripts have populated data-software-release on the
    // gscontent elements inside the dropdown (up to 10 s).
    await page.waitForFunction(
      () => {
        const content = document.querySelector(
          '.msw-selectversionbutton-content[data-id="CP543472"]'
        );
        return content && content.querySelectorAll('.gscontent[data-software-release]').length > 0;
      },
      { timeout: 10000 }
    );

    const versions = await page.evaluate(() => {
      const content = document.querySelector(
        '.msw-selectversionbutton-content[data-id="CP543472"]'
      );
      return [...content.querySelectorAll('.gscontent[data-software-release]')]
        .map(el => el.getAttribute('data-software-release'))
        .filter(v => /^\d+\.\d+\.\d+$/.test(v));
    });

    if (versions.length === 0) {
      throw new Error('Dropdown was found but contained no version entries.');
    }

    const unique = [...new Set(versions)];
    console.error(`✓ Found ${unique.length} STM32CubeCLT-Lnx versions`);

    const versionList = unique.map(version => {
      const [major, minor, patch] = version.split('.').map(Number);
      return { version, major, minor, patch, linux_supported: true, requires_auth: true };
    });

    // Sort newest first
    versionList.sort((a, b) => {
      for (const k of ['major', 'minor', 'patch']) {
        if (a[k] !== b[k]) return b[k] - a[k];
      }
      return 0;
    });

    versionList[0].is_latest = true;
    console.error(`Latest version: ${versionList[0].version}`);

    console.log(JSON.stringify(versionList));
  } finally {
    await browser.close();
  }
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
