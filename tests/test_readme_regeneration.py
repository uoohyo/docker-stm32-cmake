"""Keep operator instructions in the source template used by automatic updates."""
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
HEADING = "## Building a New STM32CubeCLT Version in CI"


def installer_section(document):
    return document.split(HEADING, 1)[1].split("\n## ", 1)[0]


class ReadmeRegenerationTests(unittest.TestCase):
    def test_installer_cache_instructions_live_in_template(self):
        template = (ROOT / "docs/template/README.template.md").read_text()
        readme = (ROOT / "README.md").read_text()
        self.assertIn(HEADING, template)
        self.assertEqual(installer_section(template), installer_section(readme))
        section = installer_section(template)
        for required in ["CUBECLT_INSTALLER_CACHE_DIR", "stm32cubeclt_1.22.0-Lin-x86_64.sh.zip", "unzip -t", "ST_AUTO_BUILD_NEW_VERSIONS", "GitHub Actions artifact", "ST license"]:
            self.assertIn(required, section)

    def test_actual_workflow_render_preserves_instructions_and_is_idempotent(self):
        workflow = (ROOT / ".github/workflows/update-documentation.yml").read_text()
        section = workflow.split("      - name: Update README.md\n", 1)[1].split("      - name:", 1)[0]
        script = textwrap.dedent(section.split("        run: |\n", 1)[1])
        template = (ROOT / "docs/template/README.template.md").read_text()
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            (work / "docs/template").mkdir(parents=True)
            (work / "docs/template/README.template.md").write_text(template)
            table = work / "table-readme.md"
            table.write_text('<tr><td>fixture-version</td><td>available</td></tr>\n')
            script = script.replace("/tmp/table-readme.md", str(table))
            subprocess.run(["bash", "-e", "-c", script], cwd=work, check=True, capture_output=True)
            rendered = (work / "README.md").read_text()
            self.assertIn(HEADING, rendered)
            self.assertEqual(installer_section(template), installer_section(rendered))
            self.assertIn(table.read_text().strip(), rendered)
            # Only the generated version table may differ from its template.
            strip_table = lambda text: re.sub(r"(?s)(<!-- VERSION_TABLE_START -->).*?(<!-- VERSION_TABLE_END -->)", r"\1\2", text)
            self.assertEqual(strip_table(template), strip_table(rendered))
            subprocess.run(["bash", "-e", "-c", script], cwd=work, check=True, capture_output=True)
            self.assertEqual(rendered, (work / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
