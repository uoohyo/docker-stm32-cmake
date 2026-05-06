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

// Known STM32CubeCLT versions (manually maintained as fallback)
// This list should be updated when new versions are released
const KNOWN_VERSIONS = [
  { version: '1.16.0', release_date: '2024-06', linux_supported: true },
  { version: '1.15.1', release_date: '2024-03', linux_supported: true },
  { version: '1.15.0', release_date: '2024-01', linux_supported: true },
  { version: '1.14.1', release_date: '2023-12', linux_supported: true },
  { version: '1.14.0', release_date: '2023-10', linux_supported: true },
  { version: '1.13.2', release_date: '2023-06', linux_supported: true },
  { version: '1.13.1', release_date: '2023-04', linux_supported: true },
  { version: '1.13.0', release_date: '2023-02', linux_supported: true },
];

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
    // Version in download links or text
    /(?:STM32CubeCLT|stm32cubeclt)[_-]?v?(\d+\.\d+\.\d+)/gi,
    // Version in URLs
    /\/(\d+\.\d+\.\d+)\//g,
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

  let scrapedVersions = [];
  try {
    const html = await fetchText(ST_CUBECLT_PAGE);
    scrapedVersions = extractVersionsFromHTML(html);
    console.error(`Found ${scrapedVersions.length} versions from ST website`);
  } catch (error) {
    console.error(`Warning: Failed to fetch ST page: ${error.message}`);
    console.error('Using known versions list as fallback');
  }

  // Merge scraped versions with known versions
  const allVersions = new Map();

  // Add known versions first
  for (const v of KNOWN_VERSIONS) {
    allVersions.set(v.version, v);
  }

  // Add scraped versions (if they're new)
  for (const version of scrapedVersions) {
    if (!allVersions.has(version)) {
      // Parse version parts
      const [major, minor, patch] = version.split('.').map(Number);

      allVersions.set(version, {
        version,
        major: String(major),
        minor: String(minor),
        patch: String(patch),
        linux_supported: true, // Assume Linux is supported for recent versions
        // Note: We cannot determine download availability without authentication
        // This will be validated separately when building
        requires_auth: true,
      });
    }
  }

  // Convert to array and add version parts
  const versionList = Array.from(allVersions.values()).map(v => {
    if (!v.major) {
      const [major, minor, patch] = v.version.split('.');
      return {
        ...v,
        major,
        minor,
        patch,
      };
    }
    return v;
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

  console.error(`\nTotal versions: ${versionList.length}`);
  console.error(`Latest version: ${versionList[0]?.version || 'none'}`);

  console.log(JSON.stringify(versionList));
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
