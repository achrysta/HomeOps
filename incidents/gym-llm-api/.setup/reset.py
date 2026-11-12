import runpy
from pathlib import Path

runpy.run_path("/tools/reset.py", run_name="__main__")
for folder in ["/answers", "/seed"]:
    for file in Path(folder).iterdir():
        if file.is_file():
            file.unlink()
