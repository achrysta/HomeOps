import secrets
from pathlib import Path

file = Path("/seed/model-id")
if not file.exists():
    file.write_text("lesson-" + secrets.token_hex(4))
