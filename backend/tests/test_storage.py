import subprocess
import sys
from pathlib import Path


def test_default_storage_root_is_repo_storage_from_backend_cwd():
    repo_root = Path(__file__).resolve().parents[2]
    backend_root = repo_root / "backend"

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.storage import storage_root; print(storage_root)",
        ],
        cwd=backend_root,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert result.stdout.strip() == str(repo_root / "storage")
