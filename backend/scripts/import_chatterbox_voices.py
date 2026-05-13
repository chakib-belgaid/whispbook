from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
DEFAULT_STORAGE_ROOT = (
    Path(os.environ.get("WHISPBOOK_STORAGE", BACKEND_ROOT.parent / "storage"))
    .expanduser()
    .resolve()
)

from app import ffmpeg  # noqa: E402
from app.models import VoiceStyle  # noqa: E402


SourceName = Literal["librivox"]
ImportEngine = Literal["chatterbox_turbo", "chatterbox", "both"]


@dataclass(frozen=True)
class ImportOptions:
    source: SourceName
    identifier: str
    title: str | None
    engine: ImportEngine
    language: str
    start: float
    duration: float
    storage: Path
    overwrite: bool


@dataclass(frozen=True)
class ResolvedSource:
    source: SourceName
    identifier: str
    title: str
    audio_url: str
    source_url: str | None
    license_note: str | None


def style_id_for(source: str, identifier: str, engine: str) -> str:
    source_slug = slugify(source)
    identifier_slug = slugify(identifier)
    engine_slug = slugify(engine)
    return f"{source_slug}-{identifier_slug}-{engine_slug}"


def import_voice(options: ImportOptions) -> list[VoiceStyle]:
    engines = engines_for(options.engine)
    created: list[VoiceStyle] = []

    for engine in engines:
        style_id = style_id_for(options.source, options.identifier, engine)
        style_path = styles_root(options.storage) / f"{style_id}.json"
        if style_path.exists() and not options.overwrite:
            continue

        resolved = resolve_source(options.source, options.identifier)
        title = options.title or resolved.title
        reference_path = styles_root(options.storage) / style_id / "reference.wav"
        source_path = source_audio_path(reference_path.parent, resolved.audio_url)
        source_path.parent.mkdir(parents=True, exist_ok=True)

        download_file(resolved.audio_url, source_path)
        normalize_reference_audio(source_path, reference_path, options.start, options.duration)

        style = VoiceStyle(
            id=style_id,
            name=f"{title} ({engine_label(engine)})",
            engine=engine,
            description=description_for(resolved),
            voice="reference",
            language=options.language,
            speed=1.0,
            exaggeration=0.5,
            cfg_weight=0.5,
            temperature=0.8,
            top_p=1.0,
            paragraph_gap_ms=450,
            comma_pause_ms=160,
            prompt_prefix="",
            reference_audio_path=str(reference_path),
            custom=True,
        )
        write_style(style_path, style)
        created.append(style)

    return created


def resolve_source(source: SourceName, identifier: str) -> ResolvedSource:
    if source == "librivox":
        return resolve_librivox_project(identifier)
    raise ValueError(f"Unsupported source: {source}")


def resolve_librivox_project(identifier: str) -> ResolvedSource:
    query = urllib.parse.urlencode({"id": identifier, "format": "json", "extended": "1"})
    payload = fetch_json(f"https://librivox.org/api/feed/audiobooks/?{query}")
    books = payload.get("books") or []
    if not books:
        raise RuntimeError(f"No LibriVox project found for id {identifier}")

    book = books[0]
    audio_url = librivox_audio_url(book)
    title = str(book.get("title") or f"LibriVox {identifier}")
    source_url = book.get("url_librivox")
    license_note = "Public domain audiobook from LibriVox."
    return ResolvedSource(
        source="librivox",
        identifier=identifier,
        title=title,
        audio_url=audio_url,
        source_url=str(source_url) if source_url else None,
        license_note=license_note,
    )


def librivox_audio_url(book: dict) -> str:
    sections = book.get("sections") or []
    numbered_sections = sorted(sections, key=lambda section: int(section.get("section_number") or 0))
    for section in numbered_sections:
        listen_url = section.get("listen_url")
        if listen_url:
            return str(listen_url)

    zip_url = book.get("url_zip_file")
    if zip_url:
        return str(zip_url)

    raise RuntimeError("LibriVox project does not include a downloadable audio URL")


def normalize_reference_audio(source_path: Path, reference_path: Path, start: float, duration: float) -> None:
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg.run_ffmpeg(
        [
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(source_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-sample_fmt",
            "s16",
            str(reference_path),
        ]
    )


def download_file(url: str, path: Path) -> None:
    last_error: Exception | None = None
    for candidate in download_candidates(url):
        try:
            request = urllib.request.Request(quote_url(candidate), headers={"User-Agent": "whispbook-voice-importer/1.0"})
            with urllib.request.urlopen(request) as response:
                path.write_bytes(response.read())
            return
        except (OSError, urllib.error.URLError) as error:
            last_error = error
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"No download candidates found for {url}")


def download_candidates(url: str) -> list[str]:
    candidates: list[str] = []
    archive_parts = archive_download_parts(url)
    if archive_parts is not None:
        identifier, filename = archive_parts
        candidates.extend(archive_metadata_candidates(identifier, filename))
    candidates.append(url)
    return unique_urls(candidates)


def archive_download_parts(url: str) -> tuple[str, str] | None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.netloc not in {"archive.org", "www.archive.org"}:
        return None
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) < 3 or path_parts[0] != "download":
        return None
    identifier = path_parts[1]
    filename = "/".join(path_parts[2:])
    return identifier, filename


def archive_metadata_candidates(identifier: str, filename: str) -> list[str]:
    try:
        metadata = fetch_json(f"https://archive.org/metadata/{urllib.parse.quote(identifier)}")
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return []

    servers = metadata_servers(metadata)
    dirs = metadata_dirs(metadata, identifier)
    encoded_filename = urllib.parse.quote(filename, safe="/")
    return [f"https://{server}{directory.rstrip('/')}/{encoded_filename}" for directory in dirs for server in servers]


def metadata_servers(metadata: dict) -> list[str]:
    servers: list[str] = []
    for key in ["workable_servers"]:
        value = metadata.get(key)
        if isinstance(value, list):
            servers.extend(str(server) for server in value if server)
    server = metadata.get("server")
    if server:
        servers.append(str(server))
    alternate = metadata.get("alternate_locations") or {}
    if isinstance(alternate, dict):
        for key in ["workable", "servers"]:
            for item in alternate.get(key) or []:
                if isinstance(item, dict) and item.get("server"):
                    servers.append(str(item["server"]))
    return unique_urls(servers)


def metadata_dirs(metadata: dict, identifier: str) -> list[str]:
    dirs: list[str] = []
    alternate = metadata.get("alternate_locations") or {}
    if isinstance(alternate, dict):
        for key in ["workable", "servers"]:
            for item in alternate.get(key) or []:
                if isinstance(item, dict) and item.get("dir"):
                    dirs.append(str(item["dir"]))
    dirs.extend([f"/0/items/{identifier}", f"/download/{identifier}"])
    return unique_urls(dirs)


def unique_urls(urls: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        unique.append(url)
    return unique


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(quote_url(url), headers={"User-Agent": "whispbook-voice-importer/1.0"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def quote_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            urllib.parse.quote(parsed.path, safe="/=&"),
            urllib.parse.quote(parsed.query, safe="=&/"),
            urllib.parse.quote(parsed.fragment),
        )
    )


def styles_root(storage: Path) -> Path:
    return Path(storage).resolve() / "styles"


def source_audio_path(style_dir: Path, url: str) -> Path:
    suffix = Path(urllib.parse.urlparse(url).path).suffix or ".audio"
    return style_dir / f"source{suffix}"


def write_style(path: Path, style: VoiceStyle) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(style.model_dump(), file, ensure_ascii=False, indent=2)


def description_for(resolved: ResolvedSource) -> str:
    parts = [f"Imported from LibriVox project {resolved.identifier}."]
    if resolved.source_url:
        parts.append(f"Source: {resolved.source_url}.")
    if resolved.license_note:
        parts.append(resolved.license_note)
    return " ".join(parts)


def engines_for(engine: ImportEngine) -> list[Literal["chatterbox", "chatterbox_turbo"]]:
    if engine == "both":
        return ["chatterbox", "chatterbox_turbo"]
    return [engine]


def engine_label(engine: str) -> str:
    if engine == "chatterbox_turbo":
        return "Chatterbox Turbo"
    if engine == "chatterbox":
        return "Chatterbox"
    return engine


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "voice"


def parse_args() -> ImportOptions:
    parser = argparse.ArgumentParser(description="Import public-domain LibriVox voices as Whispbook styles.")
    parser.add_argument("--source", choices=["librivox"], required=True)
    parser.add_argument("--id", "--identifier", dest="identifier", required=True)
    parser.add_argument("--title")
    parser.add_argument("--engine", choices=["chatterbox_turbo", "chatterbox", "both"], default="both")
    parser.add_argument("--language", default="en")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float, default=12.0)
    parser.add_argument("--storage", type=Path, default=DEFAULT_STORAGE_ROOT)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.start < 0:
        parser.error("--start must be greater than or equal to 0")
    if args.duration <= 0:
        parser.error("--duration must be greater than 0")
    return ImportOptions(
        source=args.source,
        identifier=args.identifier,
        title=args.title,
        engine=args.engine,
        language=args.language,
        start=args.start,
        duration=args.duration,
        storage=args.storage,
        overwrite=args.overwrite,
    )


def main() -> int:
    options = parse_args()
    created = import_voice(options)
    for style in created:
        print(f"Created {style.id}: {style.name}")
    if not created:
        print("No styles created; matching styles already exist. Use --overwrite to replace them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
