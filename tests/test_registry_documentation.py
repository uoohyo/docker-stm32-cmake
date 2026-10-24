"""Exercise the documentation registry fetch without network access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
URL = "https://hub.docker.com/v2/repositories/uoohyo/stm32-cmake/tags?page_size=100"


class RegistryDocumentationTests(unittest.TestCase):
    def run_fetch(self, responses):
        workflow = (ROOT / ".github/workflows/update-documentation.yml").read_text()
        section = workflow.split("      - name: Fetch Docker Hub versions\n", 1)[1].split("      - name:", 1)[0]
        script = textwrap.dedent(section.split("        run: |\n", 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "responses.json").write_text(json.dumps(responses))
            curl = folder / "curl"
            curl.write_text("#!/usr/bin/env python3\nimport json, os, sys\nfrom pathlib import Path\nx=json.loads(Path(os.environ['RESPONSES']).read_text()).get(sys.argv[-1])\nif x is None: sys.exit(22)\nprint(x if isinstance(x,str) else json.dumps(x))\n")
            curl.chmod(0o755)
            output = folder / "outputs"
            env = dict(os.environ, PATH=f"{folder}:{os.environ['PATH']}", RESPONSES=str(folder / "responses.json"), GITHUB_OUTPUT=str(output))
            proc = subprocess.run(["bash", "-e", "-c", script], env=env, capture_output=True, text=True)
            return proc.returncode, output.read_text() if output.exists() else ""

    def test_all_pages_and_nonversion_page(self):
        next_url = URL + "&page=2"
        code, output = self.run_fetch({URL: {"results": [{"name": "latest"}] * 100, "next": next_url}, next_url: {"results": [{"name": "1.22.0"}], "next": None}})
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.strip().removeprefix("tags=")), ["1.22.0"])

    def test_registry_failures_do_not_publish_output(self):
        for responses in [{}, {URL: "not json"}, {URL: {"results": []}}, {URL: {"results": [], "next": URL}}, {URL: {"results": [], "next": URL + "&page=2"}}, {URL: {"results": [], "next": "https://example.com/tags"}}]:
            with self.subTest(responses=responses):
                code, output = self.run_fetch(responses)
                self.assertNotEqual(code, 0)
                self.assertEqual(output, "")


if __name__ == "__main__":
    unittest.main()
