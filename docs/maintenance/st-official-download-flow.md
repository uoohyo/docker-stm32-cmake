# Official ST download continuation

## Scope and limits

This change removes an incorrect bare-download fallback and improves diagnostics.
It does **not** establish that authenticated installer retrieval now succeeds.
The observed HTTP 403 can only be attributed after a new authorized run records
its actual response origin, route class, and method. A completed navigation is
not proof of authentication, and a 403 is not proof of an incorrect password.

The downloader retains the existing validated, requested-version CAS entry.
It does not fabricate product, license, or SSO state. Direct CAS entry may still
lack initialization or prior consent established by the interactive product
page. If that prerequisite is required, waiting alone will not repair it.
A visible consent, account, or verification interaction stops the job without
acceptance or automatic login retries. A new license agreement requires human
review; neither a metadata `.license` selector nor successful navigation proves
that the user accepted it.

## Public frontend contract inspected

- Product page: https://www.st.com/en/development-tools/stm32cubeclt.html
- Get Software frontend: https://www.st.com/etc/clientlibs/st-site/components/get-software.min.f4beabc4089566c0eb36d4088021b79f.js
- License dialog frontend: https://www.st.com/etc/clientlibs/st-site-cx/components/get-software-dialog.min.3a171b0f78e44e121b1289e101375699.js

The product page allows up to 120 seconds for `loadingComplete`,
`readyForSoftware`, and `initDownloadScripts`. Its own download function adds
browser-held session parameters to the static metadata path. Those parameter
values are not read, logged, copied, or reconstructed by this downloader.
The frontend has product/version-bound automatic continuation and a separate
explicit license-acceptance flow. No vendor script is copied into this repository.

## Behavior

- Preserve asynchronous SSO and product-page continuation instead of forcing a
  bare URL 1.5 seconds after the first DOMContentLoaded.
- Log main-frame HTTP response method, status, origin, canonical route, MIME
  category and attachment boolean. Use `response.url()`, not a possible Chromium
  error-page URL. Never log queries, payloads, cookies, arbitrary paths or header
  filenames.
- Keep the existing exact official credential/form guards unchanged.
- Refuse a different metadata installer target before its download request and
  cancel a downloaded filename that differs from the requested metadata.
- Treat visible interaction controls as blockers, not footer text mentioning
  licenses or CAPTCHA. Unknown stalled flows time out without login retries.

## Tests and next verification

`node --test tests/test_download_links.cjs` covers URL binding and sanitized
response diagnostics. `node --test tests/test_browser_compatibility.cjs` runs
loopback/intercepted synthetic browser fixtures, including delayed SSO,
initialization longer than the removed 1.5-second delay, consent, verification,
wrong versions, forbidden responses and stalled initialization. It uses no ST
credentials and makes no vendor download requests.

An authorized build-only run must still establish the real HTTP response chain
and whether official continuation produces the exact requested installer. Do
not claim fresh build or publication success based on these synthetic tests.
