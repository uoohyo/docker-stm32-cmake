import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SmokeTests(unittest.TestCase):
    def test_tools_success_failure_and_empty_output(self):
        for mode in ("ok", "failure", "empty", "missing"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                tmp = Path(temp)
                for name in ("arm-none-eabi-gcc", "cmake", "ninja", "STM32_Programmer_CLI"):
                    if name == "STM32_Programmer_CLI" and mode == "missing":
                        continue
                    tool = tmp / name
                    text = "#!/bin/bash\necho tool-version\n"
                    if name == "ninja" and mode == "failure": text += "exit 7\n"
                    if name == "ninja" and mode == "empty": text = "#!/bin/bash\nexit 0\n"
                    tool.write_text(text)
                    tool.chmod(0o755)
                result = subprocess.run(["/bin/bash", str(ROOT / ".github/scripts/smoke-tools.sh")], env=dict(os.environ, PATH=str(tmp)), capture_output=True)
                self.assertEqual(result.returncode == 0, mode == "ok", result.stderr.decode())


if __name__ == "__main__":
    unittest.main()
