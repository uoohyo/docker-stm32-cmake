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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
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

    // ST may use HTML-encoded or version-agnostic CAS URLs. Avoid tying
    // authentication discovery to a specific product query-string layout.
    const candidates = [...html.matchAll(/data-reg-required-link-path=(["'])(.*?)\1/gi)]
      .map(match => {
        const value = match[2].replace(/&amp;/g, '&');
        try {
          const parsed = new URL(value, 'https://my.st.com');
          if (parsed.protocol !== 'https:' || parsed.hostname !== 'my.st.com' ||
              !parsed.pathname.startsWith('/cas/login')) return null;
          return { url: parsed.href, position: match.index };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (candidates.length === 0) {
      // Current ST versions may expose a download path but no CAS link.
      // Follow the official download URL and handle its authentication
      // redirect instead of guessing an ST login service URL.
      // Official ST downloads for this version no longer provide the CAS
      // service URL needed for automated authentication. Retrying the same
      // anonymous endpoint only causes long, repetitive CI failures.
      const error = new Error(`ST_AUTH_FLOW_CHANGED for ${version}: no CAS login URL. Download the official ZIP through ST and configure CUBECLT_INSTALLER_CACHE_DIR on the trusted runner.`);
      error.nonRetryable = true;
      throw error;
    }

    const targetPosition = dlMatch.index;
    const containsVersion = candidate => {
      try {
        return decodeURIComponent(candidate.url).includes(`STM32CubeCLT-Lnx.version=${version}`);
      } catch {
        return candidate.url.includes(version);
      }
    };

    // Prefer a version-specific link; otherwise use the nearest ST CAS
    // login link. The subsequent file URL remains tied to the requested version.
    const casMatch = candidates.find(containsVersion) ||
      candidates.sort((a, b) =>
        Math.abs(a.position - targetPosition) - Math.abs(b.position - targetPosition))[0];

    if (!containsVersion(casMatch)) {
      console.error(`No exact CAS URL for ${version}; using closest ST CAS login link`);
    }

    return {
      downloadUrl: `https://www.st.com${dlMatch[1]}`,
      casLoginUrl: casMatch.url,
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
    // Hide headless Chrome indicators
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Register download handlers BEFORE opening a download URL, since ST
    // may send the file immediately or redirect through its login service.
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: OUTPUT_DIR,
      eventsEnabled: true,
    });

    let suggestedFilename = null;
    let downloadFailed = false;
    client.on('Browser.downloadWillBegin', (event) => {
      suggestedFilename = event.suggestedFilename;
      console.error(`  Download started: ${suggestedFilename}`);
    });
    client.on('Browser.downloadProgress', (event) => {
      if (event.state === 'canceled') downloadFailed = true;
    });

    const isCasPage = () => {
      try {
        const url = new URL(page.url());
        return url.protocol === 'https:' && url.hostname === 'my.st.com';
      } catch {
        return false;
      }
    };

    // First try the version-specific CAS URL when provided, otherwise
    // allow the official download endpoint to redirect to authentication.
    console.error('Opening ST authentication/download URL...');
    await page.goto(casLoginUrl || downloadUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    }).catch(error => {
      // Chromium aborts navigation when the response is a file download.
      console.error(`  Initial navigation: ${error.message}`);
    });

    // If ST displays an intermediate page rather than redirecting, use an
    // official CAS link offered by that page; never follow arbitrary hosts.
    if (!suggestedFilename && !isCasPage()) {
      const loginLink = await page.evaluate(() => {
        const anchors = [...document.querySelectorAll('a[href]')];
        for (const anchor of anchors) {
          try {
            const url = new URL(anchor.href);
            if (url.protocol === 'https:' && url.hostname === 'my.st.com' &&
                url.pathname.startsWith('/cas/login')) return url.href;
          } catch {}
        }
        return null;
      }).catch(() => null);
      if (loginLink) {
        console.error('Following ST login link from download page...');
        await page.goto(loginLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
      }
    }

    if (isCasPage()) {
      console.error('  Waiting for ST CAS username input...');
      await page.waitForSelector('input[name="username"]', { timeout: 30000 });
      console.error('  Entering ST credentials...');
      await page.type('input[name="username"]', USERNAME, { delay: 50 });
      await page.type('input[name="password"]', PASSWORD, { delay: 50 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }),
        page.keyboard.press('Enter'),
      ]);
      if (isCasPage()) throw new Error('ST login failed — still on CAS page');
      console.error('  Login navigation succeeded');
    }

    // In some ST flows the authenticated redirect begins a file download.
    // Otherwise request the exact version URL with the same browser session.
    if (!suggestedFilename) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!suggestedFilename && !downloadFailed) {
      console.error('Requesting STM32CubeCLT download...');
      await page.goto(downloadUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(error => {
        console.error(`  Download navigation: ${error.message}`);
      });
    }

    // Do not hold the self-hosted runner for the full transfer timeout when
    // ST never started a download (e.g. login/consent page).
    const downloadStartDeadline = Date.now() + 90000;
    while (!suggestedFilename && !downloadFailed && Date.now() < downloadStartDeadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (downloadFailed) throw new Error('Download was canceled by the browser');
    if (!suggestedFilename) {
      let pagePath = 'unknown';
      try {
        const u = new URL(page.url());
        // Do not log query parameters: ST can place authorization tokens there.
        pagePath = u.origin + u.pathname;
      } catch {}

      const signals = await page.evaluate(() => {
        const visible = document.body?.innerText?.toLowerCase() || '';
        return {
          login: /log[ -]?in|sign[ -]?in/.test(visible),
          guest: /download as (a )?guest/.test(visible),
          license: /license agreement|i accept/.test(visible),
          usernameInput: !!document.querySelector('input[name="username"]'),
          passwordInput: !!document.querySelector('input[type="password"]'),
        };
      }).catch(() => ({ unavailable: true }));
      throw new Error(`Download did not start within 90s; page=${pagePath}; signals=${JSON.stringify(signals)}`);
    }

    // Once the browser has started downloading, allow enough time for the
    // large STM32CubeCLT ZIP to be transferred and verified.
    const deadline = Date.now() + 20 * 60 * 1000;

    const outFile = path.join(OUTPUT_DIR, suggestedFilename);
    let prevSize = -1, stable = 0;
    const STABLE_CHECKS = 5;        // 5 checks × 5s = 25s (balanced: safer than 15s, faster than 40s)
    const CHECK_INTERVAL = 5000;    // 5 seconds between checks
    while (stable < STABLE_CHECKS && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, CHECK_INTERVAL));
      const sz = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
      if (sz > 0 && sz === prevSize) { stable++; } else { stable = 0; prevSize = sz; }
      if (sz > 0) console.error(`  ${Math.round(sz / 1024 / 1024)} MB downloaded...`);
    }

    const finalSize = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
    if (finalSize < 1024 * 1024) throw new Error(`File too small (${finalSize} bytes) — likely an error page`);

    // Verify ZIP integrity to catch corrupted/incomplete downloads
    console.error('Verifying ZIP integrity...');
    const { execSync } = require('child_process');
    try {
      execSync(`unzip -t "${outFile}"`, { stdio: 'pipe' });
      console.error('✓ ZIP integrity check passed');
    } catch (err) {
      throw new Error(`Corrupted ZIP file: ${err.message}`);
    }

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
      const outFile = await downloadWithAuth(info);

      // Final verification in retry loop (redundant with downloadWithAuth, but ensures robustness)
      const { execSync } = require('child_process');
      execSync(`unzip -t "${outFile}"`, { stdio: 'pipe' });
      console.error('✓ Download and verification successful');
      return;
    } catch (e) {
      lastError = e;
      console.error(`[Attempt ${attempt}] Failed: ${e.message}`);
      if (e.nonRetryable) break;
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
