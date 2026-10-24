// Local HTML-only compatibility smoke test; never visits ST or downloads tools.
// Run with PUPPETEER_EXECUTABLE_PATH if a preinstalled Chrome is available.
const assert = require('node:assert/strict');
const puppeteer = require('../.github/scripts/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('stm32-downloader-fixture-test');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US' });
    await page.setContent('<a data-reg-required-link-path="product=STM32CubeCLT-Lnx.version=1.22.0.html">Download</a>');
    const html = await page.content();
    const versions = [...html.matchAll(/product=STM32CubeCLT-Lnx\.version=(\d+\.\d+\.\d+)\.html/g)].map(match => match[1]);
    assert.deepEqual(versions, ['1.22.0']);
    const session = await page.createCDPSession();
    await session.detach();
    console.log('PASS: browser fixture, scraper extraction, and CDP API compatibility');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
