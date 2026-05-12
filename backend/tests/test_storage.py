import subprocess
import sys
from pathlib import Path

from app import storage


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


def test_bundled_styles_are_loaded_with_tracked_reference_audio(monkeypatch, tmp_path):
    runtime_root = tmp_path / "runtime-storage"
    bundled_root = tmp_path / "voice-styles"
    style_id = "librivox-test-chatterbox"
    reference_path = bundled_root / style_id / "reference.wav"
    reference_path.parent.mkdir(parents=True)
    reference_path.write_bytes(b"reference audio")

    monkeypatch.setattr(storage, "storage_root", runtime_root)
    monkeypatch.setattr(storage, "books_root", runtime_root / "books")
    monkeypatch.setattr(storage, "styles_root", runtime_root / "styles")
    monkeypatch.setattr(storage, "previews_root", runtime_root / "previews")
    monkeypatch.setattr(storage, "jobs_root", runtime_root / "jobs")
    monkeypatch.setattr(storage, "bundled_styles_root", bundled_root)

    storage.write_json(
        bundled_root / f"{style_id}.json",
        {
            "id": style_id,
            "name": "Tracked LibriVox voice",
            "engine": "chatterbox",
            "description": "Public domain audiobook from LibriVox.",
            "voice": "af_heart",
            "language": "en",
            "reference_audio_path": f"{style_id}/reference.wav",
            "custom": True,
        },
    )

    styles = {style.id: style for style in storage.list_styles()}
    public_style = styles[style_id]
    assert public_style.reference_audio_path is None
    assert public_style.reference_audio_url == f"/style-media/{style_id}/reference.wav"

    loaded_style = storage.load_style(style_id)
    assert loaded_style.reference_audio_path == str(reference_path.resolve())
