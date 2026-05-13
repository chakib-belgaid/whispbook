from __future__ import annotations

import io
import json
import math
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import ffmpeg
from .capabilities import tts_capabilities
from .jobs import (
    JobRunner,
    merge_style,
    normalize_style_for_engine,
    render_annotated_paragraph,
    strip_paralinguistic_tags,
    validate_voice_ranges,
)
from .models import (
    Book,
    BookPatch,
    EngineCapabilities,
    GenerateJob,
    GenerateRequest,
    HealthResponse,
    Paragraph,
    PreviewRequest,
    PreviewResponse,
    VoiceStyle,
)
from .storage import (
    delete_book,
    file_url,
    list_books,
    list_styles,
    load_book,
    previews_root,
    public_style,
    save_book,
    save_custom_style,
    save_source_document,
    storage_root,
)
from .subtitles import SubtitleCue, write_vtt
from .text_processing import build_book_from_text
from .tts import TTSManager


app = FastAPI(title="Whispbook", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://0.0.0.0:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
storage_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(storage_root)), name="media")

tts_manager = TTSManager()
job_runner = JobRunner(tts_manager)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        ok=True,
        ffmpeg=ffmpeg.ffmpeg_available(),
        engines={
            "kokoro": engine_import_available("kokoro"),
            "chatterbox": engine_import_available("chatterbox"),
            "chatterbox_turbo": engine_import_available("chatterbox"),
            "mock": False,
        },
        storage_path=str(storage_root),
    )


@app.get("/api/styles", response_model=List[VoiceStyle])
def get_styles() -> List[VoiceStyle]:
    return [public_style(style) for style in list_styles()]


@app.get("/api/tts/capabilities", response_model=Dict[str, EngineCapabilities])
def get_tts_capabilities() -> Dict[str, EngineCapabilities]:
    return tts_capabilities()


@app.post("/api/styles/custom", response_model=VoiceStyle)
async def create_custom_style(
    name: str = Form(...),
    engine: str = Form("chatterbox"),
    params_json: str = Form("{}"),
    reference_start_seconds: float = Form(0),
    reference_audio: Optional[UploadFile] = File(None),
) -> VoiceStyle:
    try:
        params = json.loads(params_json or "{}")
        if not isinstance(params, dict):
            raise ValueError("params_json must be an object")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    style_id = uuid.uuid4().hex
    reference_path = None
    reference_url = None
    if reference_audio is not None:
        content = await reference_audio.read()
        path = save_reference_audio(
            style_id,
            reference_audio.filename,
            content,
            reference_start_seconds=reference_start_seconds,
        )
        reference_path = str(path)
        reference_url = file_url(path)

    style = VoiceStyle(
        id=style_id,
        name=name,
        engine=engine,
        description=params.get("description", "Custom imported style"),
        voice=params.get("voice", "af_heart"),
        language=params.get("language", "en" if engine.startswith("chatterbox") else "a"),
        speed=float(params.get("speed", 1.0)),
        exaggeration=float(params.get("exaggeration", 0.5)),
        cfg_weight=float(params.get("cfg_weight", 0.5)),
        temperature=float(params.get("temperature", 0.8)),
        top_p=float(params.get("top_p", 1.0)),
        paragraph_gap_ms=int(params.get("paragraph_gap_ms", 450)),
        comma_pause_ms=int(params.get("comma_pause_ms", 160)),
        prompt_prefix=params.get("prompt_prefix", ""),
        reference_audio_path=reference_path,
        reference_audio_url=reference_url,
        custom=True,
    )
    return save_custom_style(normalize_style_for_engine(style))


def save_reference_audio(
    style_id: str,
    filename: str | None,
    content: bytes,
    *,
    reference_start_seconds: float = 0,
) -> Path:
    start_seconds = normalize_reference_start_seconds(reference_start_seconds)
    target_dir = storage_root / "styles" / style_id
    target_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(filename or "reference.wav").suffix or ".wav"
    path = target_dir / f"reference{extension}"
    if start_seconds == 0:
        path.write_bytes(content)
        return path

    source_path = target_dir / f"reference-source{extension}"
    source_path.write_bytes(content)
    try:
        ffmpeg.run_ffmpeg(
            [
                "-ss",
                f"{start_seconds:.3f}",
                "-i",
                str(source_path),
                "-vn",
                str(path),
            ]
        )
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=f"Could not trim reference audio: {error}") from error
    finally:
        source_path.unlink(missing_ok=True)
    return path


def normalize_reference_start_seconds(value: float) -> float:
    if not math.isfinite(value):
        raise HTTPException(status_code=400, detail="reference_start_seconds must be finite.")
    return max(0.0, value)


@app.get("/api/books", response_model=List[Book])
def books() -> List[Book]:
    return list_books()


@app.get("/api/books/{book_id}", response_model=Book)
def get_book(book_id: str) -> Book:
    return load_or_404(book_id)


@app.delete("/api/books/{book_id}", status_code=204)
def remove_book(book_id: str) -> Response:
    delete_book(book_id)
    return Response(status_code=204)


@app.post("/api/books/import", response_model=Book)
async def import_book(file: UploadFile = File(...), title: str = Form("")) -> Book:
    filename = filename_for_upload(file)
    validate_supported_document(filename)
    content = await file.read()
    text = extract_document_text(content, filename)
    book = build_book_from_text(title or Path(filename).stem, filename, text)
    save_book(book)
    save_source_document(book.id, filename, content)
    return book


@app.patch("/api/books/{book_id}", response_model=Book)
def update_book(book_id: str, patch: BookPatch) -> Book:
    book = load_or_404(book_id)
    if patch.title is not None:
        book.title = patch.title.strip() or book.title
    cast_changed = False
    if patch.cast is not None:
        cast_changed = book.cast != patch.cast
        book.cast = patch.cast

    chapters_by_id = {chapter.id: chapter for chapter in book.chapters}
    cast_ids = {member.id for member in book.cast}
    for chapter_patch in patch.chapters:
        chapter = chapters_by_id.get(chapter_patch.id)
        if chapter is None:
            continue
        content_changed = cast_changed or chapter.title != chapter_patch.title or chapter.selected != chapter_patch.selected
        chapter.title = chapter_patch.title.strip() or chapter.title
        chapter.selected = chapter_patch.selected
        paragraphs_by_id = {paragraph.id: paragraph for paragraph in chapter.paragraphs}
        for paragraph_patch in chapter_patch.paragraphs:
            paragraph = paragraphs_by_id.get(paragraph_patch.id)
            if paragraph is None:
                continue
            errors = validate_voice_ranges(paragraph_patch.text.strip(), paragraph_patch.voice_ranges, cast_ids)
            if errors:
                raise HTTPException(status_code=422, detail=" ".join(errors))
            if (
                paragraph.text != paragraph_patch.text
                or paragraph.included != paragraph_patch.included
                or paragraph.voice_ranges != paragraph_patch.voice_ranges
            ):
                content_changed = True
            paragraph.text = paragraph_patch.text.strip()
            paragraph.included = paragraph_patch.included
            paragraph.voice_ranges = paragraph_patch.voice_ranges
        if content_changed:
            chapter.status = "draft"
            chapter.status_message = None
            chapter.audio_url = None
            chapter.vtt_url = None
            chapter.srt_url = None
            chapter.generated_at = None

    book.final_audio_url = None
    book.final_vtt_url = None
    book.final_srt_url = None
    book.final_package_url = None
    return save_book(book)


@app.post("/api/books/{book_id}/preview", response_model=PreviewResponse)
def preview(book_id: str, request: PreviewRequest) -> PreviewResponse:
    load_or_404(book_id)
    style = merge_style(load_style_or_404(request.style.style_id), request.style)
    errors = validate_voice_ranges(request.text, request.voice_ranges, {member.id for member in request.cast})
    if errors:
        raise HTTPException(status_code=422, detail=" ".join(errors))
    preview_id = uuid.uuid4().hex
    output_dir = previews_root / preview_id
    output_dir.mkdir(parents=True, exist_ok=True)
    wav_path = output_dir / "preview.wav"
    audio_path = output_dir / "preview.m4a"
    vtt_path = output_dir / "preview.vtt"
    render_annotated_paragraph(
        paragraph=Paragraph(
            id="preview-paragraph",
            index=0,
            original_text=request.subtitle_text or request.text,
            text=request.text,
            voice_ranges=request.voice_ranges,
        ),
        style=style,
        cast=request.cast,
        tts=tts_manager,
        output_path=wav_path,
    )
    ffmpeg.transcode_to_m4a(wav_path, audio_path)
    duration = ffmpeg.run_ffprobe_duration(audio_path)
    write_vtt(str(vtt_path), [SubtitleCue(0, duration, strip_paralinguistic_tags(request.subtitle_text or request.text))])
    return PreviewResponse(
        id=preview_id,
        audio_url=file_url(audio_path),
        vtt_url=file_url(vtt_path),
        duration_seconds=duration,
    )


@app.post("/api/books/{book_id}/generate", response_model=GenerateJob)
def generate(book_id: str, request: GenerateRequest) -> GenerateJob:
    load_or_404(book_id)
    if not ffmpeg.ffmpeg_available():
        raise HTTPException(status_code=500, detail="ffmpeg and ffprobe are required.")
    return job_runner.start(book_id, request)


@app.get("/api/jobs/{job_id}", response_model=GenerateJob)
def job_status(job_id: str) -> GenerateJob:
    try:
        return job_runner.get(job_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Job not found.") from error


def load_or_404(book_id: str) -> Book:
    try:
        return load_book(book_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Book not found.") from error


def load_style_or_404(style_id: str) -> VoiceStyle:
    from .storage import load_style

    try:
        return load_style(style_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Style not found.") from error


supported_document_mime_types = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".epub": "application/epub+zip",
    ".html": "text/html",
    ".htm": "text/html",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
}
supported_document_extensions = tuple(supported_document_mime_types)
preferred_document_extensions_by_mime_type: Dict[str, str] = {}
for document_extension, document_mime_type in supported_document_mime_types.items():
    preferred_document_extensions_by_mime_type.setdefault(document_mime_type, document_extension)
preferred_document_extensions_by_mime_type["text/xml"] = ".xml"


def filename_for_upload(file: UploadFile) -> str:
    filename = (file.filename or "").strip()
    if Path(filename).suffix:
        return filename

    extension = preferred_document_extensions_by_mime_type.get(file.content_type or "") or ".pdf"
    stem = Path(filename).stem or "document"
    return f"{stem}{extension}"


def validate_supported_document(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    if extension not in supported_document_mime_types:
        allowed = ", ".join(supported_document_extensions)
        raise HTTPException(status_code=400, detail=f"Upload a supported document file ({allowed}).")
    return extension


def extract_document_text(content: bytes, filename: str) -> str:
    extension = validate_supported_document(filename)
    try:
        from markitdown import MarkItDown, StreamInfo
    except ImportError as error:
        raise HTTPException(status_code=500, detail="MarkItDown is required to import documents.") from error

    try:
        result = MarkItDown(enable_plugins=False).convert_stream(
            io.BytesIO(content),
            stream_info=StreamInfo(
                filename=filename,
                extension=extension,
                mimetype=supported_document_mime_types[extension],
            ),
        )
    except Exception as error:
        raise HTTPException(status_code=422, detail="Could not convert the uploaded document to text.") from error

    extracted = (getattr(result, "text_content", "") or "").strip()
    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="No text content found. OCR for scanned documents is not included in this version.",
        )
    return extracted


def engine_import_available(engine: str) -> bool:
    try:
        if engine == "kokoro":
            __import__("kokoro")
        elif engine == "chatterbox":
            __import__("chatterbox")
        else:
            return False
        return True
    except ImportError:
        return False
