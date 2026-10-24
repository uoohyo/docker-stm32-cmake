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
  assert.match(error.message, /reason=authority/);
  assert.match(error.message, /page=https:\/\/my.st.com\/changed/);
  assert.ok(!error.message.includes('secret'));
  assert.equal(loginUrlRejectionReason('https://my.st.com/cas/login', version), 'none');
  assert.equal(loginUrlRejectionReason('https://my.st.com/changed', version), 'path');
  assert.equal(loginUrlRejectionReason('https://evil.example/cas/login', version), 'host');
  assert.equal(loginUrlRejectionReason(login('www.st.com'), '1.21.0'), 'product_version');
});
