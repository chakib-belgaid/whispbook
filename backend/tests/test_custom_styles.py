from pathlib import Path

import pytest
from fastapi import HTTPException

from app import main


def test_save_reference_audio_trims_uploaded_clip_from_start(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(main, "storage_root", tmp_path)

    def fake_run_ffmpeg(args):
        calls.append(args)
        Path(args[-1]).write_bytes(b"trimmed")

    monkeypatch.setattr(main.ffmpeg, "run_ffmpeg", fake_run_ffmpeg)

    path = main.save_reference_audio(
        "style-id",
        "voice.wav",
        b"original",
        reference_start_seconds=3.25,
    )

    source_path = tmp_path / "styles" / "style-id" / "reference-source.wav"
    assert path == tmp_path / "styles" / "style-id" / "reference.wav"
    assert path.read_bytes() == b"trimmed"
    assert source_path.exists() is False
    assert calls == [
        [
            "-ss",
            "3.250",
            "-i",
            str(source_path),
            "-vn",
            str(path),
        ]
    ]


def test_normalize_reference_start_seconds_rejects_non_finite_values():
    with pytest.raises(HTTPException) as caught:
        main.normalize_reference_start_seconds(float("inf"))

    assert caught.value.status_code == 400
    assert "reference_start_seconds" in caught.value.detail
