#!/usr/bin/env node
/**
 * Download STM32CubeCLT-Lnx installer.
 *
 * Strategy (in order):
 *   1. GitHub Releases cache — check if the installer was pre-uploaded to a
 *      GitHub Release tagged "cache-stm32cubeclt-{version}". If found, download
 *      directly via the GitHub API (no ST credentials needed in CI).
 *   2. ST website with CAS SSO — uses Puppeteer to authenticate via my.st.com
 *      and trigger a browser download. Requires ST_USERNAME / ST_PASSWORD and
 *      network access to my.st.com (blocked from GitHub-hosted runners; use a
 *      self-hosted runner or the cache-installer workflow to pre-populate).
 *
 * Required env vars: CUBECLT_VERSION, OUTPUT_DIR
 * For ST download:   ST_USERNAME, ST_PASSWORD
 * For GH Releases:   GITHUB_TOKEN (automatically available in Actions)
 *
 * Stdout: absolute path of the downloaded file
 * Stderr: progress / diagnostic messages
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const VERSION    = process.env.CUBECLT_VERSION;
const USERNAME   = process.env.ST_USERNAME;
const PASSWORD   = process.env.ST_PASSWORD;
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || '.');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || 'uoohyo/docker-stm32-cmake';
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
// Strategy 1: GitHub Releases cache
// ---------------------------------------------------------------------------
async function tryDownloadFromReleases(version) {
  if (!GITHUB_TOKEN) {
    console.error('[GH Releases] No GITHUB_TOKEN — skipping cache check');
    return null;
  }

  const releaseTag = `cache-stm32cubeclt-${version}`;
  console.error(`[GH Releases] Checking for release tag: ${releaseTag}`);

  const releaseInfo = await apiGet(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${releaseTag}`,
    GITHUB_TOKEN
  );

  if (!releaseInfo) {
    console.error(`[GH Releases] Tag ${releaseTag} not found — will download from ST`);
    return null;
  }

  const assets = releaseInfo.assets || [];
  const asset = assets.find(a => a.name.endsWith('.sh.zip'));
  if (!asset) {
    console.error(`[GH Releases] No .sh.zip asset in release ${releaseTag}`);
    return null;
  }

  console.error(`[GH Releases] Found asset: ${asset.name} (${Math.round(asset.size / 1024 / 1024)} MB)`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, asset.name);

  await downloadFile(asset.url, outFile, {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/octet-stream',
    'User-Agent': 'download-cubeclt/1.0',
  });

  const finalSize = fs.statSync(outFile).size;
  if (finalSize < 1024 * 1024) {
    fs.unlinkSync(outFile);
    throw new Error(`Downloaded file too small (${finalSize} bytes)`);
  }

  console.error(`[GH Releases] Downloaded: ${outFile} (${Math.round(finalSize / 1024 / 1024)} MB)`);
  return outFile;
}

function apiGet(url, token) {
  return new Promise((resolve) => {
    const opts = {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'download-cubeclt/1.0',
      },
    };
    https.get(url, opts, (res) => {
      if (res.statusCode === 404) { res.resume(); resolve(null); return; }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function downloadFile(url, dest, headers) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const proto = url.startsWith('https') ? https : http;
    const opts = { headers };

    function doGet(requestUrl) {
      proto.get(requestUrl, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
          return;
        }
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    }
    doGet(url);
  });
}

// ---------------------------------------------------------------------------
// Strategy 2: ST website with CAS SSO
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

async function downloadWithAuth({ casLoginUrl, downloadUrl }) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.error('Navigating to CAS login...');
    await page.goto(casLoginUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    console.error(`  URL: ${page.url()}`);

    if (page.url().includes('my.st.com')) {
      await page.waitForSelector('input[name="username"]', { timeout: 15000 });
      await page.type('input[name="username"]', USERNAME, { delay: 30 });
      await page.type('input[name="password"]', PASSWORD, { delay: 30 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }),
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

    console.error('Navigating to download URL...');
    await page.goto(downloadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    const deadline = Date.now() + 15 * 60 * 1000;
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
    return outFile;
  } finally {
    await browser.close();
  }
}

async function downloadFromST() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('ST credentials not set (ST_USERNAME / ST_PASSWORD). Cannot download from ST website.\n' +
      'Solution: Upload the installer to GitHub Releases first using the cache-installer workflow.');
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.error(`\n[ST Download Attempt ${attempt}/${MAX_RETRIES}]`);
      const info = await getVersionInfo(VERSION);
      console.error(`Download URL: ${info.downloadUrl}`);
      const outFile = await downloadWithAuth(info);
      console.log(outFile);
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!VERSION) {
    console.error('Required env var: CUBECLT_VERSION');
    process.exit(1);
  }
  console.error(`Downloading STM32CubeCLT-Lnx ${VERSION} to ${OUTPUT_DIR}`);

  // Try GitHub Releases cache first
  try {
    const cachedFile = await tryDownloadFromReleases(VERSION);
    if (cachedFile) {
      console.log(cachedFile);
      return;
    }
  } catch (e) {
    console.error(`[GH Releases] Error: ${e.message} — falling back to ST download`);
  }

  // Fall back to ST download
  console.error('Falling back to ST website download (requires my.st.com access)...');
  await downloadFromST();
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
