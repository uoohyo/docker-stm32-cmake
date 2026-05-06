#!/usr/bin/env node
/**
 * Download STM32CubeCLT-Lnx installer using Puppeteer.
 *
 * Why Puppeteer: ST's download proxy requires an authenticated session established
 * via CAS SSO. Plain curl/fetch requests are blocked by ST's anti-bot layer.
 * Chrome's TLS fingerprint and header set pass through consistently.
 *
 * Flow:
 *   1. Fetch sw-versions-nli.html (direct navigation) to get the download path
 *      and CAS login URL for the requested version.
 *   2. Navigate to the CAS login URL (includes ?service= so the ticket is bound
 *      to www.st.com) and fill in credentials.
 *   3. After CAS redirects back to www.st.com, navigate to the download URL.
 *   4. Capture the file via CDP download behavior; poll until stable.
 *
 * Required env vars: CUBECLT_VERSION, ST_USERNAME, ST_PASSWORD
 * Optional env var:  OUTPUT_DIR (default: current directory)
 *
 * Stdout: absolute path of the downloaded file (for use in shell scripts)
 * Stderr: progress / diagnostic messages
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const VERSION    = process.env.CUBECLT_VERSION;
const USERNAME   = process.env.ST_USERNAME;
const PASSWORD   = process.env.ST_PASSWORD;
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || '.');
const MAX_RETRIES = 3;

const ST_VERSIONS_URL = 'https://www.st.com/content/st_com/en/products/development-tools/software-development-tools/stm32-software-development-tools/stm32-ides/stm32cubeclt.sw-versions-nli.html';

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

// ---------------------------------------------------------------------------
// Step 1: fetch download path and CAS login URL for the requested version
// ---------------------------------------------------------------------------
async function getVersionInfo(version) {
  console.error('Fetching version list from ST...');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Referer': 'https://www.st.com/en/development-tools/stm32cubeclt.html' });

    const res = await page.goto(ST_VERSIONS_URL, { waitUntil: 'networkidle2', timeout: 120000 });
    const html = await res.text();

    const dlMatch = html.match(
      new RegExp(`data-download-path="(/bin/st/s3-software-download\\?s3url=publish/STM32CubeCLT-Lnx/${esc(version)}/[^"]+\\.sh\\.zip)"`, 'i')
    );
    if (!dlMatch) throw new Error(`Download path not found for ${version}`);

    const casMatch = html.match(
      new RegExp(`data-reg-required-link-path="(https://my\\.st\\.com/cas/login[^"]*product=STM32CubeCLT-Lnx\\.version=${esc(version)}[^"]*)"`, 'i')
    );
    if (!casMatch) throw new Error(`CAS login URL not found for ${version}`);

    return {
      downloadUrl: `https://www.st.com${dlMatch[1]}`,
      casLoginUrl: casMatch[1].replace(/&amp;/g, '&'),
    };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Step 2 + 3: authenticate via CAS, then download the file
// ---------------------------------------------------------------------------
async function downloadWithAuth({ casLoginUrl, downloadUrl }) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to CAS login (service= param ties the ticket to www.st.com)
    // Use 'load' not 'networkidle2' — ST login page has persistent background
    // requests that prevent networkidle2 from ever firing.
    console.error('Navigating to CAS login...');
    await page.goto(casLoginUrl, { waitUntil: 'load', timeout: 90000 });
    console.error(`  URL: ${page.url()}`);

    if (page.url().includes('my.st.com')) {
      // Fill in credentials
      await page.waitForSelector('input[name="username"]', { timeout: 15000 });
      await page.type('input[name="username"]', USERNAME, { delay: 30 });
      await page.type('input[name="password"]', PASSWORD, { delay: 30 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 90000 }),
        page.evaluate(() => {
          const btn = document.querySelector('input[type="submit"], button[type="submit"]');
          if (btn) btn.click();
        }),
      ]);

      console.error(`  After login URL: ${page.url()}`);
      if (page.url().includes('my.st.com') || page.url().includes('cas/login')) {
        throw new Error('Login failed — still on CAS page. Check ST credentials.');
      }
      console.error('  Login succeeded');
    } else {
      console.error('  Already authenticated');
    }

    // Set up Puppeteer CDP download to OUTPUT_DIR
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: OUTPUT_DIR,
      eventsEnabled: true,
    });

    let suggestedFilename = null;
    let downloadFailed = false;

    client.on('Browser.downloadWillBegin', (e) => {
      suggestedFilename = e.suggestedFilename;
      console.error(`  Download started: ${suggestedFilename}`);
    });
    client.on('Browser.downloadProgress', (e) => {
      if (e.state === 'canceled') downloadFailed = true;
    });

    // Navigate to download URL (may not fully "load" — that's expected for a file)
    console.error('Navigating to download URL...');
    await page.goto(downloadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    // Poll until the download file appears and stabilises
    const deadline = Date.now() + 15 * 60 * 1000; // 15 min
    while (!suggestedFilename && !downloadFailed && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
    }
    if (downloadFailed) throw new Error('Download was canceled by the browser');
    if (!suggestedFilename) throw new Error('Download did not start — check if the version is available');

    const outFile = path.join(OUTPUT_DIR, suggestedFilename);
    let prevSize = -1, stable = 0;
    while (stable < 3 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      const sz = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
      if (sz > 0 && sz === prevSize) { stable++; } else { stable = 0; prevSize = sz; }
      if (sz > 0) console.error(`  ${Math.round(sz / 1024 / 1024)} MB downloaded...`);
    }

    const finalSize = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
    if (finalSize < 1024 * 1024) throw new Error(`File too small (${finalSize} bytes) — likely an error page`);

    console.error(`Download complete: ${outFile} (${Math.round(finalSize / 1024 / 1024)} MB)`);
    console.log(outFile); // stdout: path for calling scripts
    return outFile;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main: retry loop
// ---------------------------------------------------------------------------
async function main() {
  if (!VERSION || !USERNAME || !PASSWORD) {
    console.error('Required env vars: CUBECLT_VERSION, ST_USERNAME, ST_PASSWORD');
    process.exit(1);
  }
  console.error(`Downloading STM32CubeCLT-Lnx ${VERSION} to ${OUTPUT_DIR}`);

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.error(`\n[Attempt ${attempt}/${MAX_RETRIES}]`);
      const info = await getVersionInfo(VERSION);
      console.error(`Download URL: ${info.downloadUrl}`);
      await downloadWithAuth(info);
      return;
    } catch (e) {
      lastError = e;
      console.error(`[Attempt ${attempt}] Failed: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 15000;
        console.error(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
