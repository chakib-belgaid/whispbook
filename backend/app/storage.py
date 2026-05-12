from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Dict, List

from .models import Book, GenerateJob, VoiceStyle


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STORAGE_ROOT = REPO_ROOT / "storage"
DEFAULT_BUNDLED_STYLES_ROOT = REPO_ROOT / "voice_styles"


def configured_storage_root() -> Path:
    configured = os.environ.get("WHISPBOOK_STORAGE")
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_STORAGE_ROOT.resolve()


def configured_bundled_styles_root() -> Path:
    configured = os.environ.get("WHISPBOOK_BUNDLED_STYLES")
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_BUNDLED_STYLES_ROOT.resolve()


storage_root = configured_storage_root()
bundled_styles_root = configured_bundled_styles_root()
books_root = storage_root / "books"
styles_root = storage_root / "styles"
previews_root = storage_root / "previews"
jobs_root = storage_root / "jobs"


def ensure_storage() -> None:
    for path in [books_root, styles_root, previews_root, jobs_root]:
        path.mkdir(parents=True, exist_ok=True)


def book_dir(book_id: str) -> Path:
    return books_root / book_id


def book_json_path(book_id: str) -> Path:
    return book_dir(book_id) / "book.json"


def save_book(book: Book) -> Book:
    ensure_storage()
    target = book_dir(book.id)
    target.mkdir(parents=True, exist_ok=True)
    book.updated_at = time.time()
    write_json(book_json_path(book.id), book.model_dump())
    return book


def load_book(book_id: str) -> Book:
    path = book_json_path(book_id)
    if not path.exists():
        raise FileNotFoundError(book_id)
    return Book.model_validate(read_json(path))


def list_books() -> List[Book]:
    ensure_storage()
    books: List[Book] = []
    for path in sorted(books_root.glob("*/book.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        books.append(Book.model_validate(read_json(path)))
    return books


def delete_book(book_id: str) -> None:
    shutil.rmtree(book_dir(book_id), ignore_errors=True)


def save_source_document(book_id: str, filename: str, content: bytes) -> Path:
    target = book_dir(book_id) / "source"
    target.mkdir(parents=True, exist_ok=True)
    path = target / sanitize_filename(filename)
    path.write_bytes(content)
    return path


def default_styles() -> Dict[str, VoiceStyle]:
    styles = [
        VoiceStyle(
            id="neutral",
            name="Neutral narrator",
            engine="kokoro",
            description="Clear balanced narration",
            voice="af_heart",
            language="a",
            speed=1.0,
            exaggeration=0.5,
            cfg_weight=0.5,
            temperature=0.8,
            paragraph_gap_ms=450,
            comma_pause_ms=170,
        ),
        VoiceStyle(
            id="fantasy",
            name="Fantasy",
            engine="kokoro",
            description="Warm British fantasy narration with deliberate pacing",
            voice="bm_george",
            language="b",
            speed=0.91,
            exaggeration=0.5,
            cfg_weight=0.5,
            temperature=0.8,
            paragraph_gap_ms=620,
            comma_pause_ms=190,
        ),
        VoiceStyle(
            id="sci-fi",
            name="Sci-fi",
            engine="kokoro",
            description="Crisp narration with quick movement",
            voice="am_adam",
            language="a",
            speed=1.08,
            exaggeration=0.45,
            cfg_weight=0.45,
            temperature=0.78,
            paragraph_gap_ms=360,
            comma_pause_ms=140,
        ),
        VoiceStyle(
            id="chatterbox-default",
            name="Chatterbox default",
            engine="chatterbox",
            description="Built-in Chatterbox model voice",
            voice="default",
            language="en",
            speed=1.0,
            exaggeration=0.5,
            cfg_weight=0.5,
            temperature=0.8,
            top_p=1.0,
            paragraph_gap_ms=450,
            comma_pause_ms=160,
        ),
        VoiceStyle(
            id="chatterbox-turbo-default",
            name="Chatterbox Turbo default",
            engine="chatterbox_turbo",
            description="Built-in Chatterbox Turbo model voice",
            voice="default",
            language="en",
            speed=1.0,
            exaggeration=0.5,
            cfg_weight=0.5,
            temperature=0.8,
            top_p=1.0,
            paragraph_gap_ms=450,
            comma_pause_ms=160,
        ),
        VoiceStyle(
            id="murder-mystery",
            name="Murder mystery",
            engine="chatterbox",
            description="Tense, restrained, intimate delivery",
            voice="default",
            language="en",
            speed=0.88,
            exaggeration=0.68,
            cfg_weight=0.3,
            temperature=0.82,
            paragraph_gap_ms=720,
            comma_pause_ms=210,
        ),
        VoiceStyle(
            id="nonfiction",
            name="Nonfiction",
            engine="kokoro",
            description="Direct, steady, low-drama reading",
            voice="af_sarah",
            language="a",
            speed=1.02,
            exaggeration=0.38,
            cfg_weight=0.55,
            temperature=0.72,
            paragraph_gap_ms=420,
            comma_pause_ms=150,
        ),
    ]
    return {style.id: style for style in styles}


def list_styles() -> List[VoiceStyle]:
    ensure_storage()
    styles = default_styles()
    for path in style_json_paths(bundled_styles_root):
        style = read_style(path)
        styles[style.id] = public_style(style)
    for path in style_json_paths(styles_root):
        style = read_style(path)
        styles[style.id] = public_style(style)
    return list(styles.values())


def load_style(style_id: str) -> VoiceStyle:
    styles = default_styles()
    if style_id in styles:
        return styles[style_id]
    for root in [styles_root, bundled_styles_root]:
        path = root / f"{style_id}.json"
        if path.exists():
            return read_style(path)
    raise FileNotFoundError(style_id)


def save_custom_style(style: VoiceStyle) -> VoiceStyle:
    ensure_storage()
    style.custom = True
    if not style.id:
        style.id = uuid.uuid4().hex
    write_json(styles_root / f"{style.id}.json", style.model_dump())
    return public_style(style)


def public_style(style: VoiceStyle) -> VoiceStyle:
    if style.reference_audio_path:
        reference_audio_url = style.reference_audio_url or file_url(style.reference_audio_path)
        style = style.model_copy(update={"reference_audio_url": reference_audio_url})
    return style.model_copy(update={"reference_audio_path": None})


def resolve_style(style_id: str) -> VoiceStyle:
    return load_style(style_id)


def save_job(job: GenerateJob) -> GenerateJob:
    ensure_storage()
    job.updated_at = time.time()
    write_json(jobs_root / f"{job.id}.json", job.model_dump())
    return job


def load_job(job_id: str) -> GenerateJob:
    path = jobs_root / f"{job_id}.json"
    if not path.exists():
        raise FileNotFoundError(job_id)
    return GenerateJob.model_validate(read_json(path))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def read_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def style_json_paths(root: Path) -> List[Path]:
    if not root.exists():
        return []
    return sorted(root.glob("*.json"))


def read_style(path: Path) -> VoiceStyle:
    payload = read_json(path)
    reference_audio_path = payload.get("reference_audio_path")
    if reference_audio_path:
        resolved = Path(reference_audio_path)
        if not resolved.is_absolute():
            payload["reference_audio_path"] = str((path.parent / resolved).resolve())
    return VoiceStyle.model_validate(payload)


def file_url(path: str | Path) -> str:
    resolved = Path(path).resolve()
    for root, prefix in [
        (storage_root, "/media"),
        (bundled_styles_root, "/style-media"),
    ]:
        try:
            relative = resolved.relative_to(root.resolve())
        except ValueError:
            continue
        return f"{prefix}/{relative.as_posix()}"
    raise ValueError(f"{resolved} is not under a public media root")



def sanitize_filename(filename: str) -> str:
    base = os.path.basename(filename or "file")
    safe = "".join(char if char.isalnum() or char in "._-" else "-" for char in base)
    return safe.strip(".-") or "file"
