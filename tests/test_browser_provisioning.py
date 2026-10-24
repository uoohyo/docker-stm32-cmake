"""Keep every production browser consumer on the explicit provisioning path."""
import pathlib
import unittest
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BrowserProvisioningTests(unittest.TestCase):
    def test_production_jobs_share_install_and_launch_cache(self):
        for workflow, jobs in {
            'build-all-versions.yml': ['detect-versions', 'download-installers'],
            'check-new-version.yml': ['check-new-version'],
            'update-documentation.yml': ['update-versions'],
        }.items():
            source = (ROOT / '.github/workflows' / workflow).read_text()
            for name in jobs:
                with self.subTest(workflow=workflow, job=name):
                    job = re.search(rf'^  {re.escape(name)}:\n(.*?)(?=^  [\w-]+:|\Z)', source, re.M | re.S).group(1)
                    self.assertEqual(job.count('run: bash .github/scripts/install-browser.sh'), 1)
                    self.assertNotIn('npm ci', job)
                    self.assertNotIn('${{ runner.temp }}', job)

    def test_installer_uses_locked_local_cli_and_checks_executable(self):
        source = (ROOT / '.github/scripts/install-browser.sh').read_text()
        self.assertIn('set -euo pipefail', source)
        self.assertIn('RUNNER_TEMP:?', source)
        self.assertIn('GITHUB_ENV:?', source)
        self.assertIn('mktemp -d', source)
        self.assertIn('export PUPPETEER_CACHE_DIR\n', source)
        self.assertIn('>> "$GITHUB_ENV"', source)
        self.assertIn('npm ci --prefix "$SCRIPT_DIR" --ignore-scripts', source)
        self.assertIn('node "$SCRIPT_DIR/node_modules/puppeteer/lib/puppeteer/node/cli.js" browsers install chrome', source)
        self.assertIn('fs.accessSync(executable, fs.constants.X_OK)', source)
        self.assertNotIn('npx ', source)

    def test_browser_ci_uses_fresh_cache_on_linux_and_macos(self):
        source = (ROOT / '.github/workflows/validate-browser-dependencies.yml').read_text()
        self.assertIn('os: [ubuntu-latest, macos-14]', source)
        self.assertIn('run: bash .github/scripts/install-browser.sh', source)
        self.assertNotIn('${{ runner.temp }}', source)



if __name__ == '__main__':
    unittest.main()
