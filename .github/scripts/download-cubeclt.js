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
const { parseVersionInfo, validateLoginUrl, authenticationRedirectError, sanitizedLocation, validateRuntimeCasUrl, validateCredentialForm, isTrustedNavigationUrl, credentialGuardDiagnostic, navigationOriginDiagnostic, pageRouteDiagnostic, responseDiagnostic } = require('./st-download-links');

const VERSION    = process.env.CUBECLT_VERSION;
const USERNAME   = process.env.ST_USERNAME;
const PASSWORD   = process.env.ST_PASSWORD;
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || '.');
const MAX_RETRIES = 3;

const ST_VERSIONS_URL = 'https://www.st.com/content/st_com/en/products/development-tools/software-development-tools/stm32-software-development-tools/stm32-ides/stm32cubeclt.sw-versions-nli.html';

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
    if (!res || res.status() >= 400) throw new Error(`ST version page unavailable: HTTP ${res ? res.status() : 'no-response'}`);
    const html = await res.text();

    return parseVersionInfo(html, version);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Step 2 + 3: authenticate via CAS, then download the file
// ---------------------------------------------------------------------------
async function downloadWithAuth({ casLoginUrl, downloadUrl }) {
  if (!validateLoginUrl(casLoginUrl, VERSION)) throw new Error('Invalid version-bound ST authentication entry point');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    let trustedNavigation = true;
    const rejectedNavigation = [];
    const inspectNavigation = (value, source) => {
      if (isTrustedNavigationUrl(value)) return;
      trustedNavigation = false;
      if (rejectedNavigation.length < 8) rejectedNavigation.push({ source, ...navigationOriginDiagnostic(value) });
    };
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame() || frame.url() === 'about:blank') return;
      inspectNavigation(frame.url(), 'committed');
    });
    page.on('response', response => {
      const request = response.request();
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      for (const item of [...request.redirectChain(), request]) inspectNavigation(item.url(), 'http-chain');
    });
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
      console.error('  Browser download started');
    });
    client.on('Browser.downloadProgress', (event) => {
      if (event.state === 'canceled') downloadFailed = true;
    });

    // Credentials are entered only on a validated official CAS route.
    const isCasPage = () => trustedNavigation && Boolean(validateRuntimeCasUrl(page.url(), casLoginUrl, VERSION));
    const requireTrustedCredentialPage = async () => {
      const forms = await page.evaluate(() => {
        const username = document.querySelector('input[name="username"]');
        const password = document.querySelector('input[name="password"]');
        const first = username?.closest('form');
        const second = password?.closest('form');
        const submitters = first ? [...first.elements].filter(control => !control.disabled &&
          ((control.tagName === 'BUTTON' && control.type === 'submit') ||
           (control.tagName === 'INPUT' && ['submit', 'image'].includes(control.type)))) : [];
        return {
          action: first?.action || '', method: first?.method || '',
          sameForm: Boolean(first && first === second),
          usernamePresent: Boolean(username), passwordPresent: Boolean(password),
          submitters: submitters.map(control => ({
            action: control.hasAttribute('formaction') ? control.formAction : first.action,
            method: control.hasAttribute('formmethod') ? control.formMethod : first.method,
          })),
        };
      }).catch(() => ({ action: '', sameForm: false }));
      if (!isCasPage() || !validateCredentialForm(forms, page.url(), casLoginUrl, VERSION)) {
        const error = authenticationRedirectError(page.url(), forms.action, VERSION);
        error.message += `; credentialGuard=${JSON.stringify(credentialGuardDiagnostic(forms, page.url(), casLoginUrl, VERSION, trustedNavigation))}; rejectedNavigation=${JSON.stringify(rejectedNavigation)}`;
        throw error;
      }
    };

    // First try the version-specific CAS URL when provided, otherwise
    // allow the official download endpoint to redirect to authentication.
    console.error('Opening ST authentication/download URL...');
    const authResponse = await page.goto(casLoginUrl || downloadUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    }).catch(error => {
      // Chromium aborts navigation when the response is a file download.
      console.error(`  Initial navigation interrupted (${error.name}); waiting for download/form signals`);
    });

    if (authResponse) {
      console.error(`  Authentication response: ${JSON.stringify(responseDiagnostic(authResponse.status(), authResponse.headers(), page.url()))}`);
    }

    // If ST displays an intermediate page rather than redirecting, use an
    // official CAS link offered by that page; never follow arbitrary hosts.
    if (!suggestedFilename && !isCasPage()) {
      const anchors = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map(anchor => anchor.href)
      ).catch(() => []);
      const loginLink = anchors.map(value => validateLoginUrl(value, VERSION)).find(Boolean);
      if (loginLink) {
        console.error('Following ST login link from download page...');
        await page.goto(loginLink, { waitUntil: 'domcontentloaded', timeout: 90000 });
      }
    }

    if (isCasPage()) {
      console.error('  Waiting for ST CAS username input...');
      await page.waitForSelector('input[name="username"]', { timeout: 30000 });
      // A redirect while waiting for the form must not bypass origin validation.
      await requireTrustedCredentialPage();
      console.error('  Entering ST credentials on validated CAS page...');
      await page.type('input[name="username"]', USERNAME, { delay: 50 });
      await requireTrustedCredentialPage();
      await page.type('input[name="password"]', PASSWORD, { delay: 50 });
      await requireTrustedCredentialPage();
      const [submissionResponse] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }),
        page.keyboard.press('Enter'),
      ]);
      console.error(`  Login submission navigation: ${JSON.stringify(responseDiagnostic(submissionResponse?.status(), submissionResponse?.headers() || {}, page.url()))}`);
      console.error('  Login form submitted; navigation completed (authentication not yet verified)');
    }

    // In some ST flows the authenticated redirect begins a file download.
    // Otherwise request the exact version URL with the same browser session.
    if (!suggestedFilename) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!suggestedFilename && !downloadFailed) {
      const postSubmitSignals = await page.evaluate(() => {
        const visible = document.body?.innerText?.toLowerCase() || '';
        return {
          usernameInput: !!document.querySelector('input[name="username"]'),
          passwordInput: !!document.querySelector('input[type="password"]'),
          license: /license agreement|i accept/.test(visible),
          challenge: /verification code|two.factor|one.time password|captcha/.test(visible),
        };
      }).catch(() => ({ unavailable: true }));
      console.error(`  Before download request: ${JSON.stringify({ ...pageRouteDiagnostic(page.url()), trustedNavigation, signals: postSubmitSignals })}`);
      if (!trustedNavigation || pageRouteDiagnostic(page.url()).routeClass === 'cas-login' ||
          (postSubmitSignals.usernameInput && postSubmitSignals.passwordInput) || postSubmitSignals.license || postSubmitSignals.challenge) {
        const error = new Error('ST authentication/consent interaction is still present; no automatic retry or consent submission');
        error.nonRetryable = true;
        throw error;
      }
      console.error('Requesting STM32CubeCLT download...');
      const downloadResponse = await page.goto(downloadUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(error => {
        console.error(`  Download navigation interrupted (${error.name}); waiting for download signals`);
      });
      if (downloadResponse) {
        const diagnostic = responseDiagnostic(downloadResponse.status(), downloadResponse.headers(), page.url());
        console.error(`  Download response: ${JSON.stringify(diagnostic)}`);
        if ([401, 403].includes(diagnostic.status)) {
          const error = new Error(`ST download request rejected with HTTP ${diagnostic.status}; authentication is not verified`);
          error.nonRetryable = true;
          throw error;
        }
      }
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
        pagePath = sanitizedLocation(page.url());
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

    console.error(`Download complete (${Math.round(finalSize / 1024 / 1024)} MB)`);
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
      console.error(`Download endpoint: ${JSON.stringify(pageRouteDiagnostic(info.downloadUrl))}`);
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
