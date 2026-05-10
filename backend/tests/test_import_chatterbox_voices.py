import json
import subprocess
import sys
from pathlib import Path

from scripts import import_chatterbox_voices as importer


class FakeResponse:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return self.payload


def test_import_librivox_project_creates_turbo_style(monkeypatch, tmp_path):
    calls = []

    def fake_urlopen(request):
        url = request.full_url if hasattr(request, "full_url") else str(request)
        calls.append(url)
        if "api/feed/audiobooks" in url:
            payload = {
                "books": [
                    {
                        "id": 123,
                        "title": "North and South",
                        "authors": [{"first_name": "Elizabeth", "last_name": "Gaskell"}],
                        "url_librivox": "https://librivox.org/north-and-south-by-elizabeth-gaskell/",
                        "sections": [
                            {
                                "section_number": 1,
                                "title": "Chapter 1",
                                "listen_url": "https://cdn.example.test/northandsouth_01.mp3",
                            }
                        ],
                    }
                ]
            }
            return FakeResponse(json.dumps(payload).encode("utf-8"))
        return FakeResponse(b"mp3 bytes")

    ffmpeg_calls = []

    def fake_run_ffmpeg(args):
        ffmpeg_calls.append(args)
        Path(args[-1]).write_bytes(b"wav bytes")

    monkeypatch.setattr(importer.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(importer.ffmpeg, "run_ffmpeg", fake_run_ffmpeg)

    created = importer.import_voice(
        importer.ImportOptions(
            source="librivox",
            identifier="123",
            title=None,
            engine="chatterbox_turbo",
            language="en",
            start=4.5,
            duration=12.0,
            storage=tmp_path,
            overwrite=False,
        )
    )

    style_id = importer.style_id_for("librivox", "123", "chatterbox_turbo")
    style_path = tmp_path / "styles" / f"{style_id}.json"
    reference_path = tmp_path / "styles" / style_id / "reference.wav"

    assert [style.id for style in created] == [style_id]
    assert reference_path.read_bytes() == b"wav bytes"
    style = json.loads(style_path.read_text(encoding="utf-8"))
    assert style["id"] == style_id
    assert style["name"] == "North and South (Chatterbox Turbo)"
    assert style["engine"] == "chatterbox_turbo"
    assert style["language"] == "en"
    assert style["custom"] is True
    assert style["reference_audio_path"] == str(reference_path)
    assert "LibriVox project 123" in style["description"]
    assert "Public domain" in style["description"]
    assert ffmpeg_calls == [
        [
            "-ss",
            "4.500",
            "-t",
            "12.000",
            "-i",
            str(tmp_path / "styles" / style_id / "source.mp3"),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-sample_fmt",
            "s16",
            str(reference_path),
        ]
    ]
    assert any("id=123" in url and "extended=1" in url for url in calls)


def test_import_both_engines_uses_deterministic_ids_and_skips_existing(monkeypatch, tmp_path):
    def fake_resolve_librivox_project(identifier):
        return importer.ResolvedSource(
            source="librivox",
            identifier=identifier,
            title="A Room With A View",
            audio_url="https://cdn.example.test/room.mp3",
            source_url="https://librivox.org/a-room-with-a-view/",
            license_note="Public domain audiobook from LibriVox.",
        )

    downloads = []
    ffmpeg_calls = []

    def fake_download(url, path):
        downloads.append((url, path))
        path.write_bytes(b"audio")

    def fake_run_ffmpeg(args):
        ffmpeg_calls.append(args)
        Path(args[-1]).write_bytes(b"wav")

    monkeypatch.setattr(importer, "resolve_librivox_project", fake_resolve_librivox_project)
    monkeypatch.setattr(importer, "download_file", fake_download)
    monkeypatch.setattr(importer.ffmpeg, "run_ffmpeg", fake_run_ffmpeg)

    options = importer.ImportOptions(
        source="librivox",
        identifier="456",
        title=None,
        engine="both",
        language="en",
        start=0.0,
        duration=10.0,
        storage=tmp_path,
        overwrite=False,
    )

    first = importer.import_voice(options)
    second = importer.import_voice(options)

    expected_ids = [
        importer.style_id_for("librivox", "456", "chatterbox"),
        importer.style_id_for("librivox", "456", "chatterbox_turbo"),
    ]
    assert [style.id for style in first] == expected_ids
    assert second == []
    assert len(downloads) == 2
    assert len(ffmpeg_calls) == 2

    overwritten = importer.import_voice(
        importer.ImportOptions(
            source="librivox",
            identifier="456",
            title="Lucy Honeychurch",
            engine="chatterbox",
            language="en",
            start=2.0,
            duration=8.0,
            storage=tmp_path,
            overwrite=True,
        )
    )

    assert [style.id for style in overwritten] == [expected_ids[0]]
    payload = json.loads((tmp_path / "styles" / f"{expected_ids[0]}.json").read_text(encoding="utf-8"))
    assert payload["name"] == "Lucy Honeychurch (Chatterbox)"
    assert len(downloads) == 3
    assert len(ffmpeg_calls) == 3


def test_quote_url_encodes_archive_paths_with_spaces():
    url = "https://archive.org/compress/example/formats=64KBPS MP3&file=/example.zip"

    assert importer.quote_url(url) == "https://archive.org/compress/example/formats=64KBPS%20MP3&file=/example.zip"


def test_download_candidates_include_archive_metadata_servers(monkeypatch):
    def fake_fetch_json(url):
        assert url == "https://archive.org/metadata/anne_greengables_librivox"
        return {
            "server": "ia800105.us.archive.org",
            "workable_servers": ["ia600105.us.archive.org"],
            "alternate_locations": {"workable": [{"server": "dn711107.ca.archive.org", "dir": "/0/items/anne_greengables_librivox"}]},
        }

    monkeypatch.setattr(importer, "fetch_json", fake_fetch_json)

    candidates = importer.download_candidates(
        "https://www.archive.org/download/anne_greengables_librivox/anne_of_green_gables_01_montgomery_64kb.mp3"
    )

    assert candidates[:2] == [
        "https://ia600105.us.archive.org/0/items/anne_greengables_librivox/anne_of_green_gables_01_montgomery_64kb.mp3",
        "https://ia800105.us.archive.org/0/items/anne_greengables_librivox/anne_of_green_gables_01_montgomery_64kb.mp3",
    ]
    assert candidates[-1].startswith("https://www.archive.org/download/")


def test_script_help_runs_from_repo_root():
    script = Path(__file__).resolve().parents[1] / "scripts" / "import_chatterbox_voices.py"

    result = subprocess.run(
        [sys.executable, str(script), "--help"],
        cwd=Path(__file__).resolve().parents[2],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert "--source" in result.stdout
    assert "--identifier" in result.stdout
