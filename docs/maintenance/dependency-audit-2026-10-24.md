# Downloader dependency audit: 2026-10-24

## Scope and commands

The lockfile belongs to the CI scraper/downloader in `.github/scripts`. Its npm dependencies are production dependencies of this CI utility, not application-development-only packages. The Dockerfile does not copy this npm tree into the published STM32 toolchain image.

Commands used:

```sh
npm audit --package-lock-only --json
npm install --save-exact puppeteer@25.16.0 --ignore-scripts --no-audit
PUPPETEER_SKIP_DOWNLOAD=true npm ci --ignore-scripts --no-audit
npm audit --omit=dev --audit-level=high
```

No `audit fix --force`, package overrides, ST login, proprietary installer download, or registry deployment was performed. The final direct dependency is pinned exactly to Puppeteer `25.16.0`, with a declared Node.js runtime of `>=22.12.0`.

## Results

The initial audit of the original lockfile reported 16 affected package entries (15 high, 1 moderate), rather than the 11 high entries recorded in earlier workflow logs. Audit results change with advisory data. These counts include packages affected through transitive dependencies; they are not a count of independent exploitable vulnerabilities.

A compatible lock refresh updates Puppeteer 24.43.0 to 24.43.1 and its transitive dependencies. That intermediate lockfile reported 10 high affected entries. Updated direct advisory targets include:

| Dependency | Before | After | Advisory examples |
| --- | --- | --- | --- |
| `js-yaml` | 4.1.1 | 4.3.2 | [YAML merge CPU exhaustion](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| `ip-address` | 10.2.0 | 10.7.4 | [Address parsing denial of service](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) |
| `ws` | 8.20.0 | 8.22.0 | [Fragment memory exhaustion](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) |

## Intermediate findings and exposure

The 10 affected entries after the intermediate refresh were `@puppeteer/browsers`, `basic-ftp`, `chromium-bidi`, `extract-zip`, `get-uri`, `pac-proxy-agent`, `proxy-agent`, `puppeteer`, `puppeteer-core`, and `zod`.

- `extract-zip`: [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3), archive symlink/path traversal. The relevant CI exposure is browser archive installation through Puppeteer's browser manager, not proof that an ST installer ZIP uses this JavaScript package. Avoid untrusted browser archives and custom download mirrors. This review does not prove exploitability in the current CI environment.
- `basic-ftp`: [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r), pathological FTP listing input. It is reachable through the proxy/PAC dependency chain. The repository's ST URLs use HTTPS and do not directly call the FTP listing API, but proxy configuration and indirect reachability have not been exhaustively verified.
- `zod`: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), oversized collection validation. This enters the tree through Chromium BiDi; the scripts use Puppeteer's default Chrome connection and CDP methods, not an explicit BiDi setup. That reduces the obvious direct exposure but is not proof of unreachability.

## Final remediation and audit result

Puppeteer `25.16.0` was selected explicitly from the official npm package, rather than applying a forced audit fix. Its supported runtime is Node.js `>=22.12.0`; all repository workflows executing these scripts use `actions/setup-node@v5` with Node `22`, while the browser regression matrix also exercises Node `24`. The version selector resolves a current Node 22 patch, not Node 22.0.0. The Docker image does not execute this npm utility.

The new browser-manager dependency uses `modern-tar` instead of the unpatched `extract-zip` dependency. The refreshed, locked dependency graph reports **0 vulnerabilities** under `npm audit --omit=dev --audit-level=high`. There are no remaining npm audit warnings requiring an exception as of this audit; this is not a guarantee that future advisories will remain absent. No attack or credential exposure was found or claimed.

Official compatibility references: [Puppeteer system requirements](https://pptr.dev/guides/system-requirements), [Puppeteer 25.16.0 release](https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-v25.16.0).

## Validation and limits

- Clean `npm ci --ignore-scripts` succeeded with the refreshed lockfile.
- Both changed workflow YAML files parse, and their embedded Bash steps pass syntax checks.
- Metadata tests cover numeric/order-independent latest selection, unavailable-version filtering, malformed data, and a six-row README limit.
- Registry documentation tests cover pagination, a page with no version tags, HTTP failure, malformed JSON/schema, repeated/missing pages, and unexpected pagination hosts.
- The earlier local Chromium fixture was blocked by executor socket restrictions; no security restriction was bypassed. Real browser compatibility was subsequently verified in GitHub Actions on both Node 22 and Node 24: [successful browser matrix](https://github.com/uoohyo/docker-stm32-cmake/actions/runs/40119595358).
- The loopback-only fixture checks CommonJS loading, browser launch, user agent/headers, document initialization, navigation/response handling, form entry, selectors, and CDP download events plus downloaded bytes. It uses no ST credentials, vendor requests, or proprietary installer. The new browser-dependency workflow repeats the fixture and audit on relevant changes.
- [Reliability CI](https://github.com/uoohyo/docker-stm32-cmake/actions/runs/40119595403) covers version parsing and download-link safety regression tests. Local Python (23 tests) and ST-link Node (5 tests) suites also passed.
- These checks establish dependency/API compatibility, not successful live ST authentication. Live ST scraping, authenticated download, and installer execution remain a separate authorized canary; this audit does not claim they passed.

## Production provisioning follow-up

The paired self-hosted macOS canary [40120532211](https://github.com/uoohyo/docker-stm32-cmake/actions/runs/40120532211) subsequently failed before ST contact: neither 1.21.0 nor 1.11.1 could find the expected Chrome 156.0.8078.47. `npm ci` and the zero-warning audit had succeeded. Puppeteer's package postinstall is best-effort, so successful npm installation alone is insufficient evidence that Chrome exists; the logs do not establish whether local npm configuration or a suppressed installer failure caused this instance.

The follow-up explicitly invokes the CLI from the locked local package, provisions Chrome into a job-local runner temporary cache, and checks its executable before credentials are used. Both installation and later launch receive the same cache environment. Fresh-cache browser CI now includes Linux and macOS and verifies the launched browser revision. Issue #48 remains open until the actual paired self-hosted canary confirms browser launch; this is separate from ST login success.
