"""Только собственные named volumes зала. API останавливает сервисы перед сбросом."""
import runpy
import shutil
from pathlib import Path

runpy.run_path("/tools/reset.py", run_name="__main__")
for directory in ["/opt/airflow", "/seed", "/answers", "/results", "/dataset"]:
    for path in Path(directory).iterdir():
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
