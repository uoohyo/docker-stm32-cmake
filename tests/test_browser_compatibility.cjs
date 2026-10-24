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
