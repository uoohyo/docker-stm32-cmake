#!/usr/bin/env node
/**
 * Scrape STM32CubeCLT versions from ST website.
 *
 * Strategy:
 *   1. Fetch the STM32CubeCLT product page
 *   2. Extract version information from the page content
 *   3. For each version, determine if it's downloadable (requires ST account)
 *
 * Note: ST requires authentication for downloads, so we can only detect
 * versions from the public page. Actual download availability is validated
 * separately using ST credentials.
 */

const ST_CUBECLT_PAGE = 'https://www.st.com/en/development-tools/stm32cubeclt.html';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };


async function fetchText(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractVersionsFromHTML(html) {
  const versions = new Set();

  // Try different patterns that ST might use
  const patterns = [
    // data-software-release attribute (most reliable)
    /data-software-release="(\d+\.\d+\.\d+)"/gi,
    // data-version attribute
    /data-version="(\d+\.\d+\.\d+)"/gi,
    // Version in div class versionoption
    /<div class="versionoption">\s*(\d+\.\d+\.\d+)/gi,
    // Version in download links or text
    /(?:STM32CubeCLT|stm32cubeclt)[_-]?v?(\d+\.\d+\.\d+)/gi,
    // Version in URLs
    /version=(\d+\.\d+\.\d+)/gi,
    // Standalone version numbers
    /Version\s+(\d+\.\d+\.\d+)/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const version = match[1];
      // Validate version format (X.Y.Z)
      if (/^\d+\.\d+\.\d+$/.test(version)) {
        versions.add(version);
      }
    }
  }

  return Array.from(versions);
}

async function scrapeVersions() {
  console.error(`Fetching ${ST_CUBECLT_PAGE}...`);

  const html = await fetchText(ST_CUBECLT_PAGE);
  const scrapedVersions = extractVersionsFromHTML(html);

  if (scrapedVersions.length === 0) {
    throw new Error('No versions found on ST website. Check if the page structure has changed.');
  }

  console.error(`✓ Successfully scraped ${scrapedVersions.length} versions from ST website`);

  // Convert to version objects
  const versionList = scrapedVersions.map(version => {
    const [major, minor, patch] = version.split('.');
    return {
      version,
      major,
      minor,
      patch,
      linux_supported: true,
      requires_auth: true,
    };
  });

  // Sort newest first
  versionList.sort((a, b) => {
    const av = [a.major, a.minor, a.patch].map(Number);
    const bv = [b.major, b.minor, b.patch].map(Number);
    for (let i = 0; i < 3; i++) {
      if (av[i] !== bv[i]) return bv[i] - av[i];
    }
    return 0;
  });

  // Mark the newest as is_latest
  if (versionList.length > 0) {
    versionList[0].is_latest = true;
  }

  console.error(`Total versions detected: ${versionList.length}`);
  console.error(`Latest version: ${versionList[0].version}`);

  console.log(JSON.stringify(versionList));
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
