from __future__ import annotations

from dataclasses import dataclass
import re
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

from . import ffmpeg
from .models import Book, CastMember, Chapter, ChapterJobState, GenerateJob, GenerateRequest, Paragraph, VoiceRange, VoiceStyle
from .storage import book_dir, file_url, load_book, load_style, save_book, save_job
from .subtitles import SubtitleCue as Cue
from .subtitles import offset_cues, write_srt, write_vtt
from .text_processing import iter_included_paragraphs
from .tts import TTSManager


paralinguistic_tag_pattern = re.compile(r"\s*\[[A-Za-z][A-Za-z0-9 _-]{0,40}\]")


@dataclass(frozen=True)
class AnnotatedTTSSegment:
    text: str
    style: VoiceStyle


class JobRunner:
    def __init__(self, tts: TTSManager) -> None:
        self.tts = tts
        self._lock = threading.Lock()
        self._jobs: Dict[str, GenerateJob] = {}

    def start(self, book_id: str, request: GenerateRequest) -> GenerateJob:
        book = load_book(book_id)
        selected_chapters = selected_chapter_ids(book, request.chapter_ids)
        job = GenerateJob(
            id=uuid.uuid4().hex,
            book_id=book_id,
            status="queued",
            created_at=time.time(),
            updated_at=time.time(),
            message="Queued",
            progress=0,
            chapters=[
                ChapterJobState(chapter_id=chapter.id, title=chapter.title, status="queued")
                for chapter in book.chapters
                if chapter.id in selected_chapters
            ],
        )
        self._remember(job)
        thread = threading.Thread(target=self._run_safe, args=(job.id, request), daemon=True)
        thread.start()
        return job

    def _run_safe(self, job_id: str, request: GenerateRequest) -> None:
        try:
            self._run(job_id, request)
        except Exception as error:
            job = self.get(job_id)
            job.status = "error"
            job.error = str(error)
            job.message = str(error)
            self._remember(job)
            traceback.print_exc()

    def _run(self, job_id: str, request: GenerateRequest) -> None:
        job = self.get(job_id)
        book = load_book(job.book_id)
        style = merge_style(load_style(request.style.style_id), request.style)
        selected_ids = selected_chapter_ids(book, request.chapter_ids)
        output_dir = book_dir(book.id) / "generated" / job.id
        output_dir.mkdir(parents=True, exist_ok=True)

        job.status = "running"
        job.message = "Generating chapters"
        self._remember(job)

        chapter_audio_files: List[Path] = []
        full_cues: List[Cue] = []
        chapter_metadata: List[tuple[str, float, float]] = []
        timeline_offset = 0.0
        total = max(1, len(selected_ids))

        for index, chapter in enumerate(book.chapters):
            if chapter.id not in selected_ids:
                continue
            self._set_chapter_status(job, chapter.id, "generating", "Rendering speech")
            update_book_chapter_status(book, chapter.id, "generating", "Rendering speech")
            save_book(book)

            chapter_result = render_chapter(
                book=book,
                chapter=chapter,
                style=style,
                tts=self.tts,
                output_dir=output_dir / chapter.id,
                subtitle_source=request.subtitle_source,
            )
            chapter_audio_files.append(chapter_result["audio_path"])
            chapter_duration = chapter_result["duration"]
            chapter_metadata.append((chapter.title, timeline_offset, timeline_offset + chapter_duration))
            full_cues.extend(offset_cues(chapter_result["cues"], timeline_offset))
            timeline_offset += chapter_duration

            apply_chapter_result(book, chapter.id, chapter_result)
            self._set_chapter_status(
                job,
                chapter.id,
                "done",
                "Generated",
                audio_url=chapter_result["audio_url"],
                vtt_url=chapter_result["vtt_url"],
                srt_url=chapter_result["srt_url"],
            )
            job.progress = round(((len(chapter_audio_files)) / total) * 84, 1)
            save_book(book)
            self._remember(job)

        full_vtt = output_dir / "audiobook.vtt"
        full_srt = output_dir / "audiobook.srt"
        write_vtt(str(full_vtt), full_cues)
        write_srt(str(full_srt), full_cues)

        metadata_path = output_dir / "chapters.ffmetadata"
        ffmpeg.write_chapter_metadata(metadata_path, book.title, chapter_metadata)
        final_audio = output_dir / "audiobook.m4b"
        ffmpeg.mux_book_audio(chapter_audio_files, full_srt, metadata_path, final_audio)

        book.final_audio_url = file_url(final_audio)
        book.final_vtt_url = file_url(full_vtt)
        book.final_srt_url = file_url(full_srt)
        book.final_package_url = file_url(final_audio)
        save_book(book)

        job.status = "done"
        job.progress = 100
        job.message = "Audiobook ready"
        job.final_audio_url = book.final_audio_url
        job.final_vtt_url = book.final_vtt_url
        job.final_srt_url = book.final_srt_url
        job.final_package_url = book.final_package_url
        self._remember(job)

    def get(self, job_id: str) -> GenerateJob:
        with self._lock:
            if job_id in self._jobs:
                return self._jobs[job_id].model_copy(deep=True)
        from .storage import load_job

        return load_job(job_id)

    def _remember(self, job: GenerateJob) -> None:
        with self._lock:
            job.updated_at = time.time()
            self._jobs[job.id] = job.model_copy(deep=True)
            save_job(job)

    def _set_chapter_status(
        self,
        job: GenerateJob,
        chapter_id: str,
        status: str,
        message: str,
        audio_url: Optional[str] = None,
        vtt_url: Optional[str] = None,
        srt_url: Optional[str] = None,
    ) -> None:
        for chapter in job.chapters:
            if chapter.chapter_id == chapter_id:
                chapter.status = status  # type: ignore[assignment]
                chapter.message = message
                chapter.audio_url = audio_url or chapter.audio_url
                chapter.vtt_url = vtt_url or chapter.vtt_url
                chapter.srt_url = srt_url or chapter.srt_url
                break


def render_chapter(
    book: Book,
    chapter: Chapter,
    style: VoiceStyle,
    tts: TTSManager,
    output_dir: Path,
    subtitle_source: str,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "segments"
    raw_dir.mkdir(parents=True, exist_ok=True)
    gap_seconds = max(0.0, style.paragraph_gap_ms / 1000.0)
    silence_path = raw_dir / "silence.wav"
    if gap_seconds > 0:
        ffmpeg.make_silence(silence_path, gap_seconds)

    sequence_files: List[Path] = []
    cues: List[Cue] = []
    timeline = 0.0
    paragraph_count = 0
    for paragraph in iter_included_paragraphs(chapter):
        paragraph_count += 1
        wav_path = raw_dir / f"{paragraph.index:04d}.wav"
        render_annotated_paragraph(
            paragraph=paragraph,
            style=style,
            cast=book.cast,
            tts=tts,
            output_path=wav_path,
        )
        duration = ffmpeg.run_ffprobe_duration(wav_path)
        sequence_files.append(wav_path)
        subtitle_text = paragraph.original_text if subtitle_source == "original" else paragraph.text
        subtitle_text = strip_paralinguistic_tags(subtitle_text)
        cues.append(Cue(start=timeline, end=timeline + duration, text=subtitle_text))
        timeline += duration
        if gap_seconds > 0:
            sequence_files.append(silence_path)
            timeline += gap_seconds

    if paragraph_count == 0:
        raise RuntimeError(f"{chapter.title} has no included paragraphs.")

    chapter_wav = output_dir / "chapter.wav"
    chapter_audio = output_dir / f"{safe_asset_name(chapter.title)}.m4a"
    ffmpeg.concat_audio(sequence_files, chapter_wav)
    ffmpeg.transcode_to_m4a(chapter_wav, chapter_audio)

    vtt_path = output_dir / f"{safe_asset_name(chapter.title)}.vtt"
    srt_path = output_dir / f"{safe_asset_name(chapter.title)}.srt"
    write_vtt(str(vtt_path), cues)
    write_srt(str(srt_path), cues)
    duration = ffmpeg.run_ffprobe_duration(chapter_audio)
    return {
        "audio_path": chapter_audio,
        "vtt_path": vtt_path,
        "srt_path": srt_path,
        "audio_url": file_url(chapter_audio),
        "vtt_url": file_url(vtt_path),
        "srt_url": file_url(srt_path),
        "duration": duration,
        "cues": cues,
    }


def render_annotated_paragraph(
    paragraph: Paragraph,
    style: VoiceStyle,
    cast: Sequence[CastMember],
    tts: TTSManager,
    output_path: Path,
) -> None:
    segments = build_annotated_tts_segments(
        paragraph,
        default_style=style,
        cast=cast,
        load_style=load_style,
    )
    if len(segments) == 1:
        tts.synthesize(segments[0].text, segments[0].style, output_path)
        return

    segment_dir = output_path.with_suffix("")
    segment_dir.mkdir(parents=True, exist_ok=True)
    segment_files: List[Path] = []
    for index, segment in enumerate(segments):
        segment_path = segment_dir / f"voice-segment-{index:04d}.wav"
        tts.synthesize(segment.text, segment.style, segment_path)
        segment_files.append(segment_path)
    ffmpeg.concat_audio(segment_files, output_path)


def build_annotated_tts_segments(
    paragraph: Paragraph,
    default_style: VoiceStyle,
    cast: Sequence[CastMember],
    load_style: Callable[[str], VoiceStyle],
) -> List[AnnotatedTTSSegment]:
    text = paragraph.text
    cast_by_id = {member.id: member for member in cast}
    if default_style.engine != "chatterbox_turbo" or not paragraph.voice_ranges or not cast_by_id:
        return [AnnotatedTTSSegment(text=text, style=default_style)]

    errors = validate_voice_ranges(text, paragraph.voice_ranges, set(cast_by_id))
    if errors:
        raise ValueError("; ".join(errors))

    segments: List[AnnotatedTTSSegment] = []
    cursor = 0
    for voice_range in sorted(paragraph.voice_ranges, key=lambda item: item.start):
        if voice_range.start > cursor:
            segments.append(AnnotatedTTSSegment(text=text[cursor : voice_range.start], style=default_style))

        member = cast_by_id[voice_range.cast_id]
        cast_style = normalize_style_for_engine(load_style(member.style_id))
        if cast_style.engine != "chatterbox_turbo":
            raise ValueError(f"Cast member {member.name} must use a Chatterbox Turbo style.")
        segments.append(AnnotatedTTSSegment(text=text[voice_range.start : voice_range.end], style=cast_style))
        cursor = voice_range.end

    if cursor < len(text):
        segments.append(AnnotatedTTSSegment(text=text[cursor:], style=default_style))

    return [segment for segment in segments if segment.text] or [AnnotatedTTSSegment(text=".", style=default_style)]


def validate_voice_ranges(text: str, ranges: Sequence[VoiceRange], cast_ids: set[str]) -> List[str]:
    errors: List[str] = []
    previous_end = -1
    for voice_range in sorted(ranges, key=lambda item: (item.start, item.end)):
        if voice_range.cast_id not in cast_ids:
            errors.append(f"Unknown cast member for range {voice_range.id}.")
        if voice_range.start >= voice_range.end:
            errors.append(f"Voice range {voice_range.id} must have start before end.")
        if voice_range.end > len(text):
            errors.append(f"Voice range {voice_range.id} ends outside the paragraph.")
        if previous_end > voice_range.start:
            errors.append(f"Voice range {voice_range.id} overlaps another range.")
        previous_end = max(previous_end, voice_range.end)
    return errors


def strip_paralinguistic_tags(text: str) -> str:
    cleaned = paralinguistic_tag_pattern.sub(" ", text)
    cleaned = re.sub(r"\s+([,.!?;:])", r"\1", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def apply_chapter_result(book: Book, chapter_id: str, result: dict) -> None:
    for chapter in book.chapters:
        if chapter.id == chapter_id:
            chapter.status = "done"
            chapter.status_message = "Generated"
            chapter.audio_url = result["audio_url"]
            chapter.vtt_url = result["vtt_url"]
            chapter.srt_url = result["srt_url"]
            chapter.generated_at = time.time()
            return


def update_book_chapter_status(book: Book, chapter_id: str, status: str, message: str) -> None:
    for chapter in book.chapters:
        if chapter.id == chapter_id:
            chapter.status = status  # type: ignore[assignment]
            chapter.status_message = message
            return


def selected_chapter_ids(book: Book, requested_ids: List[str]) -> set[str]:
    requested = set(requested_ids)
    if requested:
        return requested
    return {chapter.id for chapter in book.chapters if chapter.selected}


def merge_style(base: VoiceStyle, override: object) -> VoiceStyle:
    payload = base.model_dump()
    engine = getattr(override, "engine", None) or payload["engine"]
    payload["engine"] = engine
    for field in engine_style_fields(engine):
        value = getattr(override, field, None)
        if value is not None:
            payload[field] = value
    return normalize_style_for_engine(VoiceStyle.model_validate(payload))


def engine_style_fields(engine: str) -> List[str]:
    shared_fields = ["voice", "paragraph_gap_ms", "comma_pause_ms"]
    if engine == "kokoro":
        return shared_fields + ["language", "speed"]
    if engine == "chatterbox":
        return shared_fields + ["language", "exaggeration", "cfg_weight", "temperature", "top_p", "prompt_prefix"]
    if engine == "chatterbox_turbo":
        return shared_fields + ["temperature", "top_p", "prompt_prefix"]
    return ["paragraph_gap_ms", "comma_pause_ms"]


def normalize_style_for_engine(style: VoiceStyle) -> VoiceStyle:
    payload = style.model_dump()
    engine = payload["engine"]
    if engine == "kokoro":
        payload.update(
            {
                "exaggeration": 0.5,
                "cfg_weight": 0.5,
                "temperature": 0.8,
                "top_p": 1.0,
                "prompt_prefix": "",
            }
        )
    elif engine == "chatterbox":
        payload["speed"] = 1.0
    elif engine == "chatterbox_turbo":
        payload.update({"language": "en", "speed": 1.0, "exaggeration": 0.5, "cfg_weight": 0.5})
    return VoiceStyle.model_validate(payload)


def safe_asset_name(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "-" for char in value.lower())
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned[:64] or "chapter"
