const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersionInfo, validateLoginUrl } = require('../.github/scripts/st-download-links');
const version = '1.22.0';
const service = 'https://www.st.com/en/development-tools/stm32cubeclt.license=fixture.product=STM32CubeCLT-Lnx.version=1.22.0.html';
const login = host => `https://${host}/cas/login?lang=en&service=${encodeURIComponent(service)}`;
const download = `/bin/st/s3-software-download?s3url=publish/STM32CubeCLT-Lnx/${version}/en/stm32cubeclt_${version}-Lin-x86_64.sh.zip`;
const html = url => `<a data-download-path="${download}" data-reg-required-link-path="${url.replaceAll('&', '&amp;')}">Download</a>`;

test('accepts the current official www.st.com CAS host and historical my.st.com host', () => {
  for (const host of ['www.st.com', 'my.st.com']) {
    const info = parseVersionInfo(html(login(host)), version);
    assert.equal(info.casLoginUrl, login(host));
    assert.equal(info.downloadUrl, `https://www.st.com${download}`);
  }
});
test('rejects untrusted origins, unsafe paths, wrong products and wrong versions', () => {
  for (const url of [login('evil.example'), login('www.st.com.evil.example'), login('www.st.com').replace('https:', 'http:'),
    login('www.st.com').replace('/cas/login', '/cas/login-other'),
    `https://www.st.com/cas/login?service=${encodeURIComponent('https://evil.example/en/development-tools/stm32cubeclt.html')}`,
    login('www.st.com').replace('1.22.0', '1.21.0'), login('www.st.com').replace('STM32CubeCLT-Lnx', 'STM32CubeCLT-Win')]) {
    assert.equal(validateLoginUrl(url, version), null);
    assert.throws(() => parseVersionInfo(html(url), version), { nonRetryable: true });
  }
});
test('does not treat arbitrary official product pages as credential forms', () => {
  assert.equal(validateLoginUrl('https://www.st.com/en/development-tools/stm32cubeclt.html', version, true), null);
  assert.ok(validateLoginUrl('https://my.st.com/cas/login', version, true));
  assert.equal(validateLoginUrl('https://my.st.com/cas/login', version), null);
});
test('chooses the exact Linux version instead of a nearest unrelated CAS row', () => {
  const other = login('my.st.com').replace('1.22.0', '1.21.0');
  assert.equal(parseVersionInfo(html(other) + html(login('www.st.com')), version).casLoginUrl, login('www.st.com'));
});


test('untrusted redirect diagnostics omit secrets and are not retried', () => {
  const { authenticationRedirectError, loginUrlRejectionReason } = require('../.github/scripts/st-download-links');
  const error = authenticationRedirectError('https://user:secret@my.st.com/changed?token=secret#secret', 'https://my.st.com/submit?token=secret', version);
  assert.equal(error.nonRetryable, true);
  assert.match(error.message, /discoveryReason=authority/);
  assert.match(error.message, /page=https:\/\/my.st.com\/\[redacted-path\]/);
  assert.ok(!error.message.includes('secret'));
  assert.equal(loginUrlRejectionReason('https://my.st.com/cas/login', version), 'none');
  assert.equal(loginUrlRejectionReason('https://my.st.com/changed', version), 'path');
  assert.equal(loginUrlRejectionReason('https://evil.example/cas/login', version), 'host');
  assert.equal(loginUrlRejectionReason(login('www.st.com'), '1.21.0'), 'product_version');
});


test('CAS diagnostics redact matrix sessions and arbitrary path secrets', () => {
  const { sanitizedLocation, authenticationRedirectError } = require('../.github/scripts/st-download-links');
  assert.equal(sanitizedLocation('https://my.st.com/cas/login;jsessionid=secret?ticket=secret'), 'https://my.st.com/cas/login');
  assert.equal(sanitizedLocation('https://my.st.com/cas/secret/login'), 'https://my.st.com/[redacted-path]');
  const service = encodeURIComponent('https://user:secret@service.st.com:8443/secret?ticket=secret');
  const error = authenticationRedirectError(`https://my.st.com/cas/login?service=${service}`, 'https://my.st.com/cas/login;jsessionid=secret', version);
  assert.ok(!error.message.includes('secret'));
  assert.match(error.message, /service.st.com:8443/);
  assert.match(error.message, /"userinfoPresent":true/);
  assert.equal(error.nonRetryable, true);
});

test('runtime CAS supports only the observed official intermediate service', () => {
  const { validateRuntimeCasUrl } = require('../.github/scripts/st-download-links');
  const runtime = service => `https://my.st.com/cas/login?service=${encodeURIComponent(service)}`;
  const initial = login('www.st.com');
  const official = runtime('https://my.st.com/fixture-sso-service');
  assert.ok(validateRuntimeCasUrl(official, initial, version));
  assert.equal(validateLoginUrl(official, version), null, 'discovery must remain version-bound');
  assert.equal(validateRuntimeCasUrl(official, initial, '1.21.0'), null);
  assert.equal(validateRuntimeCasUrl(official, 'https://evil.example/cas/login', version), null);
  for (const service of ['http://my.st.com/sso', 'https://evil.example/sso', 'https://my.st.com.evil.example/sso', 'https://my.st.com:8443/sso', 'https://user:secret@my.st.com/sso', 'https://www.st.com/arbitrary']) {
    assert.equal(validateRuntimeCasUrl(runtime(service), initial, version), null, service);
  }
  for (const url of ['https://evil.example/cas/login', 'https://my.st.com/account', 'http://my.st.com/cas/login', 'https://my.st.com:8443/cas/login', 'https://user:secret@my.st.com/cas/login']) {
    assert.equal(validateRuntimeCasUrl(url, initial, version), null, url);
  }
});

test('credential form action must stay on the current approved CAS origin and route', () => {
  const { validateCredentialFormAction } = require('../.github/scripts/st-download-links');
  const initial = login('www.st.com');
  const page = `https://my.st.com/cas/login?service=${encodeURIComponent('https://my.st.com/fixture-sso-service')}`;
  for (const action of ['/cas/login', '/cas/login;jsessionid=SYNTHETIC_ONLY']) {
    assert.ok(validateCredentialFormAction(action, page, initial, version));
  }
  for (const action of ['https://evil.example/cas/login', 'https://www.st.com/cas/login', 'http://my.st.com/cas/login', 'https://user:secret@my.st.com/cas/login', '/other', '/cas/login;evil=secret', '/cas/login;jsessionid=secret/other', '/cas/login?service=https://evil.example/sso']) {
    assert.equal(validateCredentialFormAction(action, page, initial, version), false, action);
  }
});

test('downloader checks trust before username, password, and submission', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../.github/scripts/download-cubeclt.js'), 'utf8');
  assert.equal((source.match(/await requireTrustedCredentialPage\(\);/g) || []).length, 3);
  assert.ok(source.includes("page.on('framenavigated'"));
  assert.ok(source.includes('first === second'));
});

test('form submission overrides cannot redirect credentials or use GET', () => {
  const { validateCredentialForm, isTrustedNavigationUrl } = require('../.github/scripts/st-download-links');
  const initial = login('www.st.com');
  const page = 'https://my.st.com/cas/login';
  const form = { sameForm: true, action: page, method: 'post', submitters: [] };
  assert.ok(validateCredentialForm(form, page, initial, version));
  for (const override of [{ action: 'https://evil.example/cas/login', method: 'post' }, { action: page, method: 'get' }]) {
    assert.equal(validateCredentialForm({ ...form, submitters: [override] }, page, initial, version), false);
  }
  assert.equal(validateCredentialForm({ ...form, method: 'get' }, page, initial, version), false);
  assert.equal(validateCredentialForm({ ...form, sameForm: false }, page, initial, version), false);
  assert.ok(isTrustedNavigationUrl(page));
  for (const url of ['https://evil.example/', 'http://my.st.com/', 'https://my.st.com:8443/', 'https://secret@my.st.com/']) assert.equal(isTrustedNavigationUrl(url), false);
});

test('credential guard diagnostic identifies form and navigation failures without values', () => {
  const { credentialGuardDiagnostic } = require('../.github/scripts/st-download-links');
  const page = `https://my.st.com/cas/login?service=${encodeURIComponent('https://my.st.com/private-secret')}`;
  const form = { sameForm: true, usernamePresent: true, passwordPresent: true, method: 'post', action: '/cas/login;jsessionid=secret', submitters: [] };
  const clean = credentialGuardDiagnostic(form, page, login('www.st.com'), version, true);
  assert.equal(clean.runtimePageValid, true);
  assert.equal(clean.formActionValid, true);
  assert.equal(clean.postMethod, true);
  assert.equal(clean.trustedNavigation, true);
  assert.ok(!JSON.stringify(clean).includes('secret'));
  const bad = credentialGuardDiagnostic({ ...form, sameForm: false, passwordPresent: false, method: 'get', submitters: [{ action: 'https://evil.example/secret', method: 'get' }] }, page, login('www.st.com'), version, false);
  for (const field of ['sameForm', 'passwordPresent', 'postMethod', 'trustedNavigation', 'submitterMethodsValid', 'submitterActionsValid']) assert.equal(bad[field], false);
  assert.equal(bad.submitterCount, 1);
  assert.ok(!JSON.stringify(bad).includes('secret'));
  assert.ok(Object.values(bad).every(value => typeof value === 'boolean' || typeof value === 'number'));
});


test('discovery reason is labeled separately from runtime credential rejection', () => {
  const { authenticationRedirectError, validateRuntimeCasUrl } = require('../.github/scripts/st-download-links');
  const page = `https://my.st.com/cas/login?service=${encodeURIComponent('https://my.st.com/fixture')}`;
  assert.ok(validateRuntimeCasUrl(page, login('www.st.com'), version));
  const error = authenticationRedirectError(page, '/cas/login', version);
  assert.match(error.message, /discoveryReason=service_origin/);
  assert.ok(!error.message.includes('; reason='));
});

test('navigation diagnostics expose origins but never credential-bearing URL components', () => {
  const { navigationOriginDiagnostic } = require('../.github/scripts/st-download-links');
  const result = navigationOriginDiagnostic('https://user:secret@intermediate.example:8443/secret;jsessionid=secret?ticket=secret#secret');
  assert.deepEqual(result, { origin: 'https://intermediate.example:8443', protocol: 'https:', portPresent: true, userinfoPresent: true });
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(navigationOriginDiagnostic('data:text/html,secret').origin, 'non-http-origin');
  assert.equal(navigationOriginDiagnostic('secret').origin, 'invalid-url');
});


test('observed ST SSO bridge is navigation-only, never a credential or discovery target', () => {
  const { isTrustedNavigationUrl, validateRuntimeCasUrl, validateCredentialFormAction } = require('../.github/scripts/st-download-links');
  assert.equal(isTrustedNavigationUrl('https://sso.st.com/fixture'), true);
  for (const url of ['http://sso.st.com/fixture', 'https://sso.st.com:8443/fixture', 'https://secret@sso.st.com/fixture', 'https://sso.st.com.evil.example/fixture', 'https://other.st.com/fixture']) assert.equal(isTrustedNavigationUrl(url), false);
  assert.equal(validateLoginUrl(login('sso.st.com'), version), null);
  assert.equal(validateRuntimeCasUrl('https://sso.st.com/cas/login', login('www.st.com'), version), null);
  assert.equal(validateCredentialFormAction('https://sso.st.com/cas/login', 'https://my.st.com/cas/login', login('www.st.com'), version), false);
});

test('response diagnostics classify canonical routes without values or header filenames', () => {
  const { pageRouteDiagnostic, responseDiagnostic } = require('../.github/scripts/st-download-links');
  assert.deepEqual(pageRouteDiagnostic('https://my.st.com/cas/login;jsessionid=secret?ticket=secret'), { origin: 'https://my.st.com', routeClass: 'cas-login' });
  const diagnostic = responseDiagnostic(401, { 'content-type': 'application/json; token=secret', 'content-disposition': 'attachment; filename=secret.zip' }, 'https://www.st.com/bin/st/s3-software-download?s3url=secret');
  assert.equal(diagnostic.status, 401);
  assert.equal(diagnostic.routeClass, 'download-endpoint');
  assert.equal(diagnostic.contentType, 'application/json');
  assert.equal(diagnostic.attachment, true);
  assert.ok(!JSON.stringify(diagnostic).includes('secret'));
  assert.equal(responseDiagnostic(200, { 'content-type': 'secret' }, 'https://www.st.com/secret').contentType, 'other');
});


test('downloader fails closed on login forms and HTTP authorization rejection', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../.github/scripts/download-cubeclt.js'), 'utf8');
  assert.ok(source.includes('postSubmissionBlocked(page.url(), trustedNavigation, postSubmitSignals)'));
  assert.ok(!source.includes('postSubmitSignals.license || postSubmitSignals.challenge'));
  assert.ok(source.includes('[401, 403].includes(diagnostic.status)'));
  assert.ok(source.includes('authentication not yet verified'));
  assert.ok(!source.includes('Login navigation succeeded'));
  assert.ok(!source.includes('Download started: ${suggestedFilename}'));
  assert.ok(!source.includes('Download URL: ${info.downloadUrl}'));
  assert.ok(source.includes('responseDiagnostic(authResponse.status()'));
});


test('footer license or CAPTCHA mentions are diagnostic only, not pending interaction proof', () => {
  const { postSubmissionBlocked } = require('../.github/scripts/st-download-links');
  const footer = { license: true, challenge: true, usernameInput: false, passwordInput: false };
  assert.equal(postSubmissionBlocked('https://www.st.com/product', true, footer), false);
  assert.equal(postSubmissionBlocked('https://www.st.com/product', false, footer), true);
  assert.equal(postSubmissionBlocked('https://my.st.com/cas/login;jsessionid=secret', true, footer), true);
  assert.equal(postSubmissionBlocked('https://www.st.com/product', true, { ...footer, usernameInput: true, passwordInput: true }), true);
});
