'use strict';

const { pageRouteDiagnostic, responseDiagnostic } = require('./st-download-links');

function stopped(message) {
  const error = new Error(message);
  error.nonRetryable = true;
  return error;
}

// The metadata path identifies the installer. ST's own frontend, not this
// downloader, supplies its session-dependent request parameters.
function matchesDownloadTarget(value, expected) {
  try {
    const actual = new URL(value);
    const target = new URL(expected);
    return actual.origin === 'https://www.st.com' && !actual.username && !actual.password &&
      actual.pathname === '/bin/st/s3-software-download' &&
      actual.searchParams.getAll('s3url').length === 1 &&
      actual.searchParams.get('s3url') === target.searchParams.get('s3url');
  } catch { return false; }
}

function expectedFilename(downloadUrl) {
  const target = new URL(downloadUrl).searchParams.get('s3url');
  const name = target?.split('/').at(-1);
  if (!name || !/^[A-Za-z0-9_.-]+\.sh\.zip$/.test(name)) throw stopped('Invalid installer filename in ST metadata');
  return name;
}

// Only fixed method labels, a status, a canonical route and an origin escape.
// response.url(), rather than page.url(), identifies an HTTP error even when
// Chromium subsequently commits chrome-error://chromewebdata/.
function navigationResponseDiagnostic(response) {
  const method = response.request().method();
  return { method: ['GET', 'POST', 'HEAD'].includes(method) ? method : 'other',
    ...responseDiagnostic(response.status(), response.headers(), response.url()) };
}

function wrongProductReturn(location, version) {
  try {
    const url = new URL(location);
    if (url.origin !== 'https://www.st.com' || !url.pathname.startsWith('/en/development-tools/stm32cubeclt.')) return false;
    if (!url.pathname.includes('.product=') && !url.pathname.includes('.version=')) return false;
    return !url.pathname.endsWith(`.product=STM32CubeCLT-Lnx.version=${version}.html`);
  } catch { return false; }
}

// Runs in the page and returns booleans only. Visible controls/dialogs, not
// footer mentions of licenses or CAPTCHA, indicate an outstanding interaction.
function readFlowSignals() {
  const visible = selector => [...document.querySelectorAll(selector)].some(element => {
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0;
  });
  return {
    usernameInput: visible('input[name="username"]'),
    passwordInput: visible('input[type="password"]'),
    consent: visible('#licenseModal, #licenseModalNew, .accept-license, #userLMUTCAccept'),
    challenge: visible('input[autocomplete="one-time-code"], input[name="otp"], input[name="captcha"], iframe[src*="/recaptcha/api2/bframe"], iframe[src*="/hcaptcha.com/captcha/"]'),
    accountAction: visible('#validationModal, #loginOrCreateAccountModal, #secondDownloadUpdateModal, #downloadFailModal, #cookieAlertModal'),
    frontendReady: window.endLoadingSoftware === true,
  };
}

async function waitForOfficialDownload(page, state, { version, timeout = 120000, interval = 500, log = console.error } = {}) {
  const deadline = Date.now() + timeout;
  let lastSignals = {};
  while (Date.now() < deadline) {
    const current = state();
    if (current.failure) throw current.failure;
    if (current.filename) return current.filename;
    if (!current.trustedNavigation) throw stopped('ST navigation left the trusted flow; authentication is not verified');
    if (wrongProductReturn(page.url(), version)) throw stopped('ST returned a different product or version; download refused');
    // Execution contexts may disappear during an SSO hop. Never force a new
    // navigation just because the previous DOMContentLoaded has fired.
    const signals = await page.evaluate(readFlowSignals).catch(() => null);
    if (signals) {
      lastSignals = signals;
      if (signals.consent || signals.challenge || signals.accountAction) {
        log(`  ST interaction required: ${JSON.stringify({ ...pageRouteDiagnostic(page.url()), signals })}`);
        throw stopped('ST requires consent, verification, or account interaction; no automatic acceptance or retry');
      }
      if (signals.usernameInput && signals.passwordInput) throw stopped('ST returned a login form after submission; authentication is not verified');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  log(`  ST continuation timed out: ${JSON.stringify({ ...pageRouteDiagnostic(page.url()), signals: lastSignals })}`);
  throw stopped('Official ST download did not start within the frontend initialization window; no bare URL fallback or automatic login retry');
}

module.exports = { stopped, matchesDownloadTarget, expectedFilename, navigationResponseDiagnostic, wrongProductReturn, readFlowSignals, waitForOfficialDownload };
