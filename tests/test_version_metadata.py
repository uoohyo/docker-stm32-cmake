import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("metadata", ROOT / ".github/scripts/version-metadata.py")
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)


def versions():
    return [{"version": version, "linux_supported": True} for version in ["1.9.0", "1.11.1", "1.22.0"]]


class MetadataTests(unittest.TestCase):
    def test_latest_is_order_independent_and_numeric(self):
        self.assertEqual(metadata.latest(versions()), "1.22.0")
        self.assertEqual(metadata.latest(list(reversed(versions()))), "1.22.0")

    def test_empty_or_invalid_discovery_fails(self):
        for invalid in [[], {}, [{"version": "latest", "linux_supported": True}], [{"version": "1.0.0"}]]:
            with self.assertRaises((ValueError, AttributeError)):
                metadata.latest(invalid)

    def test_unpublished_version_has_no_available_badge_or_pull(self):
        full, readme = metadata.render(versions(), ["1.11.1", "latest"])
        new = next(line for line in full.splitlines() if "`1.22.0`" in line)
        self.assertIn("![not built]", new)
        self.assertNotIn("available", new)
        self.assertNotIn("docker pull", new)
        self.assertNotIn("1.22.0", readme)
        # Match the downstream Action's available-row selection contract.
        available = [line for line in full.splitlines() if "![available]" in line]
        self.assertEqual(len(available), 1)
        self.assertIn("`1.11.1`", available[0])

    def test_empty_registry_is_valid_but_all_unpublished(self):
        full, readme = metadata.render(versions(), [])
        self.assertNotIn("![available]", full)
        self.assertEqual(readme.strip(), "")

    def test_unsupported_never_promoted_by_unrelated_tag(self):
        full, readme = metadata.render([{"version": "1.0.0", "linux_supported": False}], ["1.0.0"])
        self.assertIn("![not supported]", full)
        self.assertNotIn("![available]", full)

    def test_invalid_registry_response_fails(self):
        for invalid in [None, {}, [None]]:
            with self.assertRaises(ValueError):
                metadata.render(versions(), invalid)

    def test_readme_is_limited_and_sorted(self):
        data = [{"version": f"1.{n}.0", "linux_supported": True} for n in range(8)]
        _, readme = metadata.render(data, [v["version"] for v in data])
        self.assertEqual(len(readme.splitlines()), 6)
        self.assertIn("v1.7.0", readme.splitlines()[0])

    def test_workflow_refreshes_after_discovery_without_closing_build_issues(self):
        workflow = (ROOT / ".github/workflows/update-documentation.yml").read_text()
        self.assertIn('"Check for New STM32CubeCLT Version"', workflow)
        self.assertIn("head_branch == 'main'", workflow)
        self.assertNotIn("Close building issue", workflow)
        self.assertNotIn("issues: write", workflow)


if __name__ == "__main__":
    unittest.main()
