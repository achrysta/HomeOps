"""reset: возвращает файлы из .original, а папки из .original/.exact делает их точной копией."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class ResetTest(unittest.TestCase):
    def run_reset(self, scenario: Path) -> str:
        env = {**os.environ, "SCENARIO_DIR": str(scenario)}
        p = subprocess.run([sys.executable, str(TOOLS / "reset.py")], env=env, capture_output=True, text=True, check=True)
        return p.stdout

    def test_restores_changed_files_and_keeps_extra_without_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Path(tmp)
            write(s / ".original/project/app.py", "orig")
            write(s / "project/app.py", "changed")
            write(s / "project/notes.txt", "свой файл")
            self.run_reset(s)
            self.assertEqual((s / "project/app.py").read_text(), "orig")
            self.assertTrue((s / "project/notes.txt").exists())

    def test_exact_dirs_drop_added_files_but_not_outside(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Path(tmp)
            write(s / ".original/project/app.py", "orig")
            write(s / ".original/project/tests/test_app.py", "test")
            write(s / ".original/.exact", "# точная копия\nproject\n../outside\n.\n")
            write(s / "project/app.py", "orig")
            write(s / "project/tests/test_app.py", "test")
            write(s / "project/conftest.py", "обход")
            write(s / "project/extra/deep/ruff.toml", "обход")
            write(s / "keep.txt", "вне папки .exact")
            out = self.run_reset(s)
            self.assertFalse((s / "project/conftest.py").exists())
            self.assertFalse((s / "project/extra").exists())
            self.assertTrue((s / "project/tests/test_app.py").exists())
            self.assertTrue((s / "keep.txt").exists())
            self.assertFalse((s / ".exact").exists())
            self.assertIn("project/conftest.py", out)


if __name__ == "__main__":
    unittest.main()
