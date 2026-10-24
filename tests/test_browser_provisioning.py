"""Keep every production browser consumer on the explicit provisioning path."""
import pathlib
import unittest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BrowserProvisioningTests(unittest.TestCase):
    def test_production_jobs_share_install_and_launch_cache(self):
        for workflow, jobs in {
            'build-all-versions.yml': ['detect-versions', 'download-installers'],
            'check-new-version.yml': ['check-new-version'],
            'update-documentation.yml': ['update-versions'],
        }.items():
            document = yaml.safe_load((ROOT / '.github/workflows' / workflow).read_text())
            for name in jobs:
                with self.subTest(workflow=workflow, job=name):
                    job = document['jobs'][name]
                    cache = job['env']['PUPPETEER_CACHE_DIR']
                    self.assertIn('runner.temp', cache)
                    self.assertIn('strategy.job-index', cache)
                    installs = [s for s in job['steps'] if s.get('run') == 'bash .github/scripts/install-browser.sh']
                    self.assertEqual(len(installs), 1)
                    self.assertFalse(any('npm ci' in s.get('run', '') for s in job['steps']))

    def test_installer_uses_locked_local_cli_and_checks_executable(self):
        source = (ROOT / '.github/scripts/install-browser.sh').read_text()
        self.assertIn('set -euo pipefail', source)
        self.assertIn('PUPPETEER_CACHE_DIR:?', source)
        self.assertIn('npm ci --prefix "$SCRIPT_DIR" --ignore-scripts', source)
        self.assertIn('node "$SCRIPT_DIR/node_modules/puppeteer/lib/puppeteer/node/cli.js" browsers install chrome', source)
        self.assertIn('fs.accessSync(executable, fs.constants.X_OK)', source)
        self.assertNotIn('npx ', source)

    def test_browser_ci_uses_fresh_cache_on_linux_and_macos(self):
        doc = yaml.safe_load((ROOT / '.github/workflows/validate-browser-dependencies.yml').read_text())
        job = doc['jobs']['compatibility']
        self.assertEqual(job['strategy']['matrix']['os'], ['ubuntu-latest', 'macos-14'])
        self.assertTrue(any('test ! -e "$PUPPETEER_CACHE_DIR"' in s.get('run', '') for s in job['steps']))
        self.assertTrue(any('install-browser.sh' in s.get('run', '') for s in job['steps']))


if __name__ == '__main__':
    unittest.main()
