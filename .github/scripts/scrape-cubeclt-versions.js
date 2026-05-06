#!/usr/bin/env node
/**
 * Scrape all STM32CubeCLT-Lnx versions from ST website via plain HTTP.
 *
 * Strategy:
 *   Fetch the sw-versions-nli endpoint directly — ST renders the full version
 *   list (all platforms, all releases) into this static HTML fragment, which
 *   is accessible without JavaScript or authentication.  Each entry contains a
 *   data-reg-required-link-path attribute of the form:
 *     ...product=STM32CubeCLT-Lnx.version=1.21.0.html
 *   Extracting that pattern gives us every available Linux version.
 *
 * Retries up to MAX_RETRIES times with increasing delays on network errors.
 */

const ST_VERSIONS_URL = 'https://www.st.com/content/st_com/en/products/development-tools/software-development-tools/stm32-software-development-tools/stm32-ides/stm32cubeclt.sw-versions-nli.html';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.st.com/en/development-tools/stm32cubeclt.html',
};
const MAX_RETRIES = 3;

async function attemptFetch(attempt) {
  console.error(`[Attempt ${attempt}] Fetching ${ST_VERSIONS_URL}...`);
  const res = await fetch(ST_VERSIONS_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const html = await res.text();
  console.error(`[Attempt ${attempt}] Received ${html.length} bytes`);

  const versions = [...new Set(
    [...html.matchAll(/product=STM32CubeCLT-Lnx\.version=(\d+\.\d+\.\d+)\.html/g)]
      .map(m => m[1])
  )];

  if (versions.length === 0) throw new Error('No STM32CubeCLT-Lnx versions found in response');

  console.error(`[Attempt ${attempt}] ✓ Found ${versions.length} versions`);
  return versions;
}

async function scrapeVersions() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const versions = await attemptFetch(attempt);

      const versionList = versions.map(version => {
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
      return;
    } catch (e) {
      lastError = e;
      console.error(`[Attempt ${attempt}] Failed: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 10000;
        console.error(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
