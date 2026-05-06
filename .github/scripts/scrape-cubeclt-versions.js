#!/usr/bin/env node
/**
 * Scrape STM32CubeCLT versions from ST website.
 *
 * Strategy (two requests):
 *   1. Fetch the main product page to find the get-software-table-body endpoint URL.
 *   2. Fetch that endpoint and extract the latest STM32CubeCLT-Lnx version from
 *      the <td data-product-rpn="STM32CubeCLT-Lnx"> table row.
 *
 * Background: version data is server-rendered into get-software-table-body.nocache.html
 * (the latest version only). The Select-Version dropdown is populated lazily by JavaScript
 * at click time, so older versions are not available without a real browser.
 */

const ST_CUBECLT_PAGE = 'https://www.st.com/en/development-tools/stm32cubeclt.html';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

async function fetchText(url, referer, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = referer ? { ...HEADERS, 'Referer': referer } : HEADERS;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractTableBodyUrl(mainHtml) {
  // In the HTML, jQuery.get paths use \/path\/to\/file (backslash-escaped slashes).
  // Do NOT anchor to "/" at the start of the capture group — the raw text starts with "\/".
  const match = mainHtml.match(/jQuery\.get\("([^"]*get-software-table-body[^"]*)"/);
  if (match) return 'https://www.st.com' + match[1].replace(/\\\//g, '/');

  throw new Error('Could not find get-software-table-body URL in the main page HTML.');
}

function extractLatestLnxVersion(tableBodyHtml) {
  // Find the <tr> that contains a <td data-product-rpn="STM32CubeCLT-Lnx"> and
  // extract the plain-text version number from a nearby <td>.
  const trMatch = tableBodyHtml.match(
    /<tr>\s*<td[^>]*data-product-rpn=["']STM32CubeCLT-Lnx["'][^>]*>[\s\S]*?<\/tr>/
  );
  if (trMatch) {
    // Third cell in that row is the version
    const tdVersionMatch = trMatch[0].match(/<td>\s*(\d+\.\d+\.\d+)\s*<\/td>/);
    if (tdVersionMatch) return tdVersionMatch[1];
  }

  // Fallback: data-version attribute on any button/link associated with CP543472
  const dvMatch = tableBodyHtml.match(
    /data-id=["']CP543472["'][^>]*data-version=["'](\d+\.\d+\.\d+)["']|data-version=["'](\d+\.\d+\.\d+)["'][^>]*data-id=["']CP543472["']/
  );
  if (dvMatch) return dvMatch[1] || dvMatch[2];

  return null;
}

async function scrapeVersions() {
  console.error(`Fetching main page: ${ST_CUBECLT_PAGE}`);
  const mainHtml = await fetchText(ST_CUBECLT_PAGE);

  const tableBodyUrl = extractTableBodyUrl(mainHtml);
  console.error(`Fetching software table: ${tableBodyUrl}`);

  const tableBodyHtml = await fetchText(tableBodyUrl, ST_CUBECLT_PAGE);

  const latestVersion = extractLatestLnxVersion(tableBodyHtml);
  if (!latestVersion) {
    throw new Error(
      'Could not extract STM32CubeCLT-Lnx version from the get-software table. ' +
      'Check the data-product-rpn and data-version attributes.'
    );
  }

  console.error(`✓ Latest STM32CubeCLT-Lnx version: ${latestVersion}`);

  const [major, minor, patch] = latestVersion.split('.').map(Number);
  const versionList = [{
    version: latestVersion,
    major,
    minor,
    patch,
    linux_supported: true,
    requires_auth: true,
    is_latest: true,
  }];

  console.log(JSON.stringify(versionList));
}

scrapeVersions().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
