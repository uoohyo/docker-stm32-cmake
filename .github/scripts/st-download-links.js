'use strict';

const LOGIN_HOSTS = new Set(['www.st.com', 'my.st.com']);
// Observed official redirect bridge only; never a credential-entry origin.
const NAVIGATION_HOSTS = new Set([...LOGIN_HOSTS, 'sso.st.com']);

function validateLoginUrl(value, version, allowMissingService = false) {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), 'https://www.st.com');
    if (url.protocol !== 'https:' || !LOGIN_HOSTS.has(url.hostname) ||
        url.port || url.username || url.password || url.pathname !== '/cas/login') return null;
    const serviceValue = url.searchParams.get('service');
    if (!serviceValue) return allowMissingService ? url.href : null;
    const service = new URL(serviceValue);
    if (service.protocol !== 'https:' || service.hostname !== 'www.st.com' ||
        service.port || service.username || service.password ||
        !service.pathname.startsWith('/en/development-tools/stm32cubeclt.') ||
        !service.pathname.endsWith('.html')) return null;
    // Authentication must be tied to the requested Linux toolchain, not a nearby OS/version row.
    if (version && !service.pathname.includes(`.product=STM32CubeCLT-Lnx.version=${version}.html`)) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Runtime CAS may wrap the original product service in ST's own SSO service.
// This exception is intentionally unavailable to discovery links.
function validateRuntimeCasUrl(value, initialLoginUrl, version) {
  if (!validateLoginUrl(initialLoginUrl, version)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !LOGIN_HOSTS.has(url.hostname) ||
        url.port || url.username || url.password || url.pathname !== '/cas/login') return null;
    if (validateLoginUrl(url.href, version, true)) return url.href;
    const service = new URL(url.searchParams.get('service'));
    if (service.protocol === 'https:' && service.hostname === 'my.st.com' &&
        !service.port && !service.username && !service.password) return url.href;
    return null;
  } catch { return null; }
}

function validateCredentialFormAction(action, pageUrl, initialLoginUrl, version) {
  if (!validateRuntimeCasUrl(pageUrl, initialLoginUrl, version)) return false;
  try {
    const page = new URL(pageUrl);
    const form = new URL(action, page);
    if (form.origin !== page.origin || form.username || form.password) return false;
    // Servlet session rewriting appends exactly this path parameter to CAS.
    if (!/^\/cas\/login(?:;jsessionid=[A-Za-z0-9._-]+)?$/.test(form.pathname)) return false;
    form.pathname = '/cas/login';
    return Boolean(validateRuntimeCasUrl(form.href, initialLoginUrl, version));
  } catch { return false; }
}

function isTrustedNavigationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && NAVIGATION_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function navigationOriginDiagnostic(value) {
  try {
    const url = new URL(value);
    return {
      origin: ['https:', 'http:'].includes(url.protocol) ? url.origin : 'non-http-origin',
      protocol: url.protocol,
      portPresent: Boolean(url.port),
      userinfoPresent: Boolean(url.username || url.password),
    };
  } catch { return { origin: 'invalid-url', protocol: 'invalid' }; }
}

function validateCredentialForm(form, pageUrl, initialLoginUrl, version) {
  const validTarget = target => target.method?.toLowerCase() === 'post' &&
    validateCredentialFormAction(target.action, pageUrl, initialLoginUrl, version);
  return Boolean(form.sameForm && validTarget(form) &&
    Array.isArray(form.submitters) && form.submitters.every(validTarget));
}

// Diagnostic values are fixed labels, booleans, and counts only: never DOM text or URLs.
function credentialGuardDiagnostic(form, pageUrl, initialLoginUrl, version, trustedNavigation) {
  const submitters = Array.isArray(form.submitters) ? form.submitters : [];
  return {
    trustedNavigation: Boolean(trustedNavigation),
    runtimePageValid: Boolean(validateRuntimeCasUrl(pageUrl, initialLoginUrl, version)),
    sameForm: Boolean(form.sameForm),
    usernamePresent: Boolean(form.usernamePresent),
    passwordPresent: Boolean(form.passwordPresent),
    postMethod: form.method?.toLowerCase() === 'post',
    formActionValid: validateCredentialFormAction(form.action, pageUrl, initialLoginUrl, version),
    submittersKnown: Array.isArray(form.submitters),
    submitterCount: submitters.length,
    submitterMethodsValid: submitters.every(target => target.method?.toLowerCase() === 'post'),
    submitterActionsValid: submitters.every(target => validateCredentialFormAction(target.action, pageUrl, initialLoginUrl, version)),
  };
}

function loginUrlRejectionReason(value, version) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return 'protocol';
    if (!LOGIN_HOSTS.has(url.hostname)) return 'host';
    if (url.port || url.username || url.password) return 'authority';
    if (url.pathname !== '/cas/login') return 'path';
    const serviceValue = url.searchParams.get('service');
    if (!serviceValue) return 'none';
    let service;
    try { service = new URL(serviceValue); } catch { return 'service_url'; }
    if (service.protocol !== 'https:' || service.hostname !== 'www.st.com' || service.port || service.username || service.password) return 'service_origin';
    if (!service.pathname.startsWith('/en/development-tools/stm32cubeclt.') || !service.pathname.endsWith('.html')) return 'service_path';
    if (version && !service.pathname.includes(`.product=STM32CubeCLT-Lnx.version=${version}.html`)) return 'product_version';
    return 'none';
  } catch { return 'invalid_url'; }
}

// Never include query strings, fragments, userinfo, or form field values in diagnostics.
function sanitizedLocation(value) {
  try {
    const url = new URL(value);
    // CAS may embed a live session ID in a semicolon path parameter.
    // Unknown routes may also carry credential material in path segments.
    const route = url.pathname.split(';', 1)[0];
    return `${url.origin}${route === '/cas/login' ? route : '/[redacted-path]'}`;
  } catch { return 'invalid-url'; }
}

function serviceOriginDiagnostic(location) {
  try {
    const target = new URL(new URL(location).searchParams.get('service'));
    return { origin: target.origin, protocol: target.protocol, portPresent: Boolean(target.port), userinfoPresent: Boolean(target.username || target.password) };
  } catch { return { origin: 'missing-or-invalid' }; }
}

function authenticationRedirectError(location, formAction, version) {
  const error = new Error(`Untrusted authentication redirect; discoveryReason=${loginUrlRejectionReason(location, version)}; page=${sanitizedLocation(location)}; form=${sanitizedLocation(formAction)}; service=${JSON.stringify(serviceOriginDiagnostic(location))}`);
  error.nonRetryable = true;
  return error;
}

function parseVersionInfo(html, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid STM32CubeCLT version');
  const downloadPaths = [...html.matchAll(/data-download-path=(["'])(.*?)\1/gi)];
  const prefix = `/bin/st/s3-software-download?s3url=publish/STM32CubeCLT-Lnx/${version}/`;
  const target = downloadPaths.map(match => match[2].replace(/&amp;/g, '&'))
    .find(value => value.startsWith(prefix) && value.endsWith('.sh.zip') && !/[\s#]/.test(value));
  if (!target) throw new Error(`Download path not found for ${version}`);
  const candidates = [...html.matchAll(/data-reg-required-link-path=(["'])(.*?)\1/gi)]
    .map(match => validateLoginUrl(match[2], version)).filter(Boolean);
  if (!candidates.length) {
    const error = new Error(`ST_AUTH_LINK_NOT_RECOGNIZED for ${version}: no validated CAS link for the requested Linux version. Review the page format or use the authorized installer cache.`);
    error.nonRetryable = true;
    throw error;
  }
  return { downloadUrl: `https://www.st.com${target}`, casLoginUrl: candidates[0] };
}

module.exports = { validateLoginUrl, parseVersionInfo, sanitizedLocation, authenticationRedirectError, loginUrlRejectionReason, serviceOriginDiagnostic, validateRuntimeCasUrl, validateCredentialFormAction, validateCredentialForm, isTrustedNavigationUrl, credentialGuardDiagnostic, navigationOriginDiagnostic };
