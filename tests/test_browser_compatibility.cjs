'use strict';
// Exercise the downloader's browser APIs against a loopback-only fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const puppeteer = require('../.github/scripts/node_modules/puppeteer');

test('CommonJS, navigation, form input, and CDP downloads remain compatible', { timeout: 60000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-compat-'));
  const payload = Buffer.from('local download fixture; not a vendor installer\n');
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.zip') {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="fixture.zip"' });
      return res.end(payload);
    }
    if (req.url.startsWith('/complete')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<a id="download" href="/fixture.zip">Download fixture</a>');
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<form action="/complete"><input name="username"><input name="password" type="password"><button type="submit">Continue</button></form>');
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const expectedVersion = require('../.github/scripts/node_modules/puppeteer-core/lib/puppeteer/revisions.js').PUPPETEER_REVISIONS.chrome;
    assert.equal((await browser.version()).split('/').at(-1), expectedVersion);
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith(`${origin}/`)) request.continue();
      else request.abort();
    });
    await page.setUserAgent('DownloaderCompatibilityFixture/1.0');
    await page.setExtraHTTPHeaders({ Referer: origin });
    await page.evaluateOnNewDocument(() => { window.fixtureLoaded = true; });
    const response = await page.goto(origin, { waitUntil: 'networkidle2' });
    assert.equal(response.status(), 200);
    assert.ok((await response.text()).includes('username'));
    assert.equal(await page.evaluate(() => window.fixtureLoaded), true);
    await page.waitForSelector('input[name="username"]');
    await page.type('input[name="username"]', 'fixture-user');
    await page.type('input[name="password"]', 'fixture-not-a-secret');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button')]);
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true });
    let filename;
    client.on('Browser.downloadWillBegin', event => { filename = event.suggestedFilename; });
    const completed = new Promise((resolve, reject) => {
      client.on('Browser.downloadProgress', event => {
        if (event.state === 'completed') resolve();
        if (event.state === 'canceled') reject(new Error('Fixture download canceled'));
      });
    });
    await page.click('#download');
    await completed;
    assert.equal(filename, 'fixture.zip');
    assert.deepEqual(await fs.readFile(path.join(directory, filename)), payload);
    await client.detach();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const { waitForOfficialDownload, stopped, matchesDownloadTarget, navigationResponseDiagnostic } = require('../.github/scripts/st-download-flow');

test('official continuation survives SSO hops and asynchronous initialization without a bare URL fallback', { timeout: 30000 }, async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'official-flow-'));
  const version = '1.21.0';
  const filename = `st-stm32cubeclt_${version}_fixture_amd64.sh.zip`;
  const target = `https://www.st.com/bin/st/s3-software-download?s3url=publish/STM32CubeCLT-Lnx/${version}/en/${filename}`;
  const product = `https://www.st.com/en/development-tools/stm32cubeclt.product=STM32CubeCLT-Lnx.version=${version}.html`;
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  const requests = [];
  const diagnostics = [];
  let downloaded;
  try {
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true });
    client.on('Browser.downloadWillBegin', event => { downloaded = event.suggestedFilename; });
    await page.setRequestInterception(true);
    page.on('response', response => {
      if (response.request().isNavigationRequest()) diagnostics.push(navigationResponseDiagnostic(response));
    });
    // Every request is answered locally or aborted. No fixture contacts ST.
    page.on('request', request => {
      const url = request.url();
      requests.push(url);
      if (url === 'https://sso.st.com/fixture') return void request.respond({ status: 200, contentType: 'text/html', body: `<script>setTimeout(() => location.href=${JSON.stringify(product)}, 200)</script>` });
      if (url === product) return void request.respond({ status: 200, contentType: 'text/html', body: `<footer>License agreement and CAPTCHA documentation</footer><script>setTimeout(() => { window.endLoadingSoftware=true; location.href=${JSON.stringify(`${target}&token=synthetic-fixture`)}; }, 1800)</script>` });
      if (matchesDownloadTarget(url, target) && new URL(url).searchParams.has('token')) return void request.respond({ status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"` }, body: 'synthetic fixture only' });
      void request.abort();
    });
    await page.goto('https://sso.st.com/fixture', { waitUntil: 'domcontentloaded' });
    assert.equal(await waitForOfficialDownload(page, () => ({ filename: downloaded, trustedNavigation: true }), { version, timeout: 10000, interval: 25, log: () => {} }), filename);
    assert.ok(requests.includes(product));
    assert.ok(!requests.includes(target), 'must not replace browser-generated request with bare metadata URL');
    assert.ok(diagnostics.some(value => value.origin === 'https://sso.st.com'));
    assert.ok(!JSON.stringify(diagnostics).includes('synthetic-fixture'));
  } finally {
    await browser.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('official continuation fails closed for auth failures, visible consent/challenge, wrong version, and stalled initialization', { timeout: 30000 }, async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const version = '1.21.0';
  try {
    for (const scenario of [
      { body: '<div id="licenseModal"><button class="accept-license">Accept</button></div>', filename: 'expected.sh.zip', expected: /requires consent/ },
      { body: '<form><input name="username"><input type="password"></form>', expected: /login form/ },
      { body: '<div id="licenseModal"><button class="accept-license">Accept</button></div>', expected: /requires consent/ },
      { body: '<input autocomplete="one-time-code">', expected: /requires consent/ },
      { body: '<p>Initializing</p>', expected: /initialization window/ },
      { body: '<p>Wrong version</p>', version: '1.22.0', expected: /different product or version/ },
      { body: '<p>Forbidden</p>', failure: stopped('ST navigation returned HTTP 403'), expected: /HTTP 403/ },
    ]) {
      const page = await browser.newPage();
      let clicks = 0;
      await page.exposeFunction('recordClick', () => { clicks++; });
      await page.setRequestInterception(true);
      page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: `${scenario.body}<script>document.addEventListener('click', recordClick)</script>` }));
      await page.goto(`https://www.st.com/en/development-tools/stm32cubeclt.product=STM32CubeCLT-Lnx.version=${scenario.version || version}.html`);
      await assert.rejects(waitForOfficialDownload(page, () => ({ trustedNavigation: true, failure: scenario.failure, filename: scenario.filename }), { version, timeout: 150, interval: 10, log: () => {} }), error => error.nonRetryable === true && scenario.expected.test(error.message));
      assert.equal(clicks, 0, 'never accepts terms or challenges automatically');
      await page.close();
    }
  } finally { await browser.close(); }
});

test('response trace distinguishes a successful login POST redirect from a forbidden return GET', { timeout: 30000 }, async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const diagnostics = [];
    await page.setRequestInterception(true);
    page.on('response', response => {
      if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) diagnostics.push(navigationResponseDiagnostic(response));
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === 'https://my.st.com' && url.pathname === '/cas/login' && request.method() === 'GET') {
        return void request.respond({ status: 200, contentType: 'text/html', body: '<form method="POST" action="/cas/login"><button>Submit empty fixture form</button></form>' });
      }
      if (url.origin === 'https://my.st.com' && url.pathname === '/cas/login' && request.method() === 'POST') {
        return void request.respond({ status: 303, headers: { Location: 'https://www.st.com/en/development-tools/stm32cubeclt.html?ticket=synthetic-private' } });
      }
      if (url.origin === 'https://www.st.com' && url.pathname === '/en/development-tools/stm32cubeclt.html') {
        return void request.respond({ status: 403, contentType: 'text/html', body: 'Synthetic forbidden return page' });
      }
      void request.abort();
    });
    await page.goto('https://my.st.com/cas/login');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button')]);
    assert.ok(diagnostics.some(value => value.method === 'POST' && value.status === 303 && value.origin === 'https://my.st.com'));
    assert.ok(diagnostics.some(value => value.method === 'GET' && value.status === 403 && value.origin === 'https://www.st.com' && value.routeClass === 'product-page'));
    assert.ok(!JSON.stringify(diagnostics).includes('synthetic-private'));
  } finally { await browser.close(); }
});
