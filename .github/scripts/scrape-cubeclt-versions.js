#!/usr/bin/env node
/**
 * Scrape STM32CubeCLT versions from ST website.
 *
 * Targets gscontent divs with data-software-prmis-itemname="STM32CubeCLT-Lnx"
 * to extract data-software-release version numbers from the same opening tag.
 */

const ST_CUBECLT_PAGE = 'https://www.st.com/en/development-tools/stm32cubeclt.html';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};


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
  const seen = new Set();
  const versions = [];

  // Match opening div tags that contain data-software-prmis-itemname="STM32CubeCLT-Lnx".
  // Both the product name and version attributes live on the same opening tag, so we
  // only read as far as the first ">" — no cross-tag leakage is possible.
  const tagPattern = /<div[^>]*data-software-prmis-itemname="STM32CubeCLT-Lnx"[^>]*>/gi;
  const releaseAttr = /data-software-release="(\d+\.\d+\.\d+)"/i;

  let tagMatch;
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const releaseMatch = releaseAttr.exec(tagMatch[0]);
    if (releaseMatch) {
      const version = releaseMatch[1];
      if (!seen.has(version)) {
        seen.add(version);
        versions.push(version);
      }
    }
  }

  return versions;
}

async function scrapeVersions() {
  console.error(`Fetching ${ST_CUBECLT_PAGE}...`);

  const html = await fetchText(ST_CUBECLT_PAGE);
  const scrapedVersions = extractVersionsFromHTML(html);

  if (scrapedVersions.length === 0) {
    throw new Error(
      'No STM32CubeCLT-Lnx versions found on ST website. ' +
      'The page structure may have changed — check data-software-prmis-itemname attribute.'
    );
  }

  console.error(`✓ Found ${scrapedVersions.length} STM32CubeCLT-Lnx version(s)`);

  const versionList = scrapedVersions.map(version => {
    const [major, minor, patch] = version.split('.').map(Number);
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
    for (const k of ['major', 'minor', 'patch']) {
      if (a[k] !== b[k]) return b[k] - a[k];
    }
    return 0;
  });

  versionList[0].is_latest = true;

  console.error(`Latest version: ${versionList[0].version}`);
  console.error(`Total versions detected: ${versionList.length}`);

  console.log(JSON.stringify(versionList));
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});