# Downloader dependency audit: 2026-10-24

## Scope and commands

The lockfile belongs to the CI scraper/downloader in `.github/scripts`. Its npm dependencies are production dependencies of this CI utility, not application-development-only packages. The Dockerfile does not copy this npm tree into the published STM32 toolchain image.

Commands used:

```sh
npm audit --package-lock-only --json
npm update --package-lock-only --ignore-scripts --no-audit
PUPPETEER_SKIP_DOWNLOAD=true npm ci --ignore-scripts --no-audit
npm audit --package-lock-only --json
```

No `audit fix --force`, package overrides, ST login, proprietary installer download, or registry deployment was performed. The direct dependency range remains Puppeteer `^24.0.0`.

## Results

The original lockfile currently reports 16 affected package entries (15 high, 1 moderate), rather than the 11 high entries recorded in earlier workflow logs. Audit results change with advisory data. These counts include packages affected through transitive dependencies; they are not a count of independent exploitable vulnerabilities.

A compatible lock refresh updates Puppeteer 24.43.0 to 24.43.1 and its transitive dependencies. The refreshed lockfile reports 10 high affected entries. Updated direct advisory targets include:

| Dependency | Before | After | Advisory examples |
| --- | --- | --- | --- |
| `js-yaml` | 4.1.1 | 4.3.2 | [YAML merge CPU exhaustion](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| `ip-address` | 10.2.0 | 10.7.4 | [Address parsing denial of service](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) |
| `ws` | 8.20.0 | 8.22.0 | [Fragment memory exhaustion](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) |

## Remaining findings and exposure

The remaining 10 affected entries are `@puppeteer/browsers`, `basic-ftp`, `chromium-bidi`, `extract-zip`, `get-uri`, `pac-proxy-agent`, `proxy-agent`, `puppeteer`, `puppeteer-core`, and `zod`.

- `extract-zip`: [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3), archive symlink/path traversal. The relevant CI exposure is browser archive installation through Puppeteer's browser manager, not proof that an ST installer ZIP uses this JavaScript package. Avoid untrusted browser archives and custom download mirrors. This review does not prove exploitability in the current CI environment.
- `basic-ftp`: [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r), pathological FTP listing input. It is reachable through the proxy/PAC dependency chain. The repository's ST URLs use HTTPS and do not directly call the FTP listing API, but proxy configuration and indirect reachability have not been exhaustively verified.
- `zod`: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), oversized collection validation. This enters the tree through Chromium BiDi; the scripts use Puppeteer's default Chrome connection and CDP methods, not an explicit BiDi setup. That reduces the obvious direct exposure but is not proof of unreachability.

The audit suggests Puppeteer 25.16.0 as a major-version remediation. It was not applied automatically because scraper/downloader compatibility and browser runtime behavior need validation. Keep issue #48 open until the remaining findings are remediated or an explicit, reviewed response is recorded. No attack or credential exposure was found or claimed.

## Validation and limits

- Clean `npm ci --ignore-scripts` succeeded with the refreshed lockfile.
- Both changed workflow YAML files parse, and their embedded Bash steps pass syntax checks.
- Metadata tests cover numeric/order-independent latest selection, unavailable-version filtering, malformed data, and a six-row README limit.
- Registry documentation tests cover pagination, a page with no version tags, HTTP failure, malformed JSON/schema, repeated/missing pages, and unexpected pagination hosts.
- A local Puppeteer/Chromium fixture smoke test was attempted, but Chromium could not start because this executor denies the required socket operation. No security restriction was bypassed.
- Live browser scraping, ST authentication/download, and installer execution were not tested. A clean CI browser fixture and authorized download validation remain necessary before claiming full downloader compatibility.
