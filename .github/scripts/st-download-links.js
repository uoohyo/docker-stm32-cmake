'use strict';

const LOGIN_HOSTS = new Set(['www.st.com', 'my.st.com']);

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
    return `${url.origin}${url.pathname}`;
  } catch { return 'invalid-url'; }
}

function authenticationRedirectError(location, formAction, version) {
  const error = new Error(`Untrusted authentication redirect; reason=${loginUrlRejectionReason(location, version)}; page=${sanitizedLocation(location)}; form=${sanitizedLocation(formAction)}`);
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

module.exports = { validateLoginUrl, parseVersionInfo, sanitizedLocation, authenticationRedirectError, loginUrlRejectionReason };
