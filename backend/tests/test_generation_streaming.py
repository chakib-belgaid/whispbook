from pathlib import Path

from app.jobs import JobRunner, generation_progress, render_chapter
from app.models import (
    Book,
    Chapter,
    GenerateJob,
    GenerateRequest,
    Paragraph,
    StreamSegment,
    StyleOverride,
    VoiceStyle,
)
from app.tts import TTSManager


class FakeTTS(TTSManager):
    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(f"wav:{text}".encode("utf-8"))


def test_render_chapter_publishes_stream_segments_for_ready_paragraphs(monkeypatch, tmp_path):
    stub_generation_audio_pipeline(monkeypatch, tmp_path)
    book = sample_book()
    chapter = book.chapters[0]
    segments: list[StreamSegment] = []
    next_sequence = iter(range(10)).__next__

    render_chapter(
        book=book,
        chapter=chapter,
        style=sample_style(),
        tts=FakeTTS(),
        output_dir=tmp_path / "generated" / "job-1" / chapter.id,
        subtitle_source="edited",
        on_stream_segment=segments.append,
        next_stream_sequence=next_sequence,
    )

    assert [
        (
            segment.sequence,
            segment.chapter_id,
            segment.paragraph_id,
            segment.paragraph_index,
            segment.audio_url,
            segment.duration_seconds,
            segment.text_preview,
        )
        for segment in segments
    ] == [
        (
            0,
            "ch-1",
            "p-1",
            0,
            "/media/generated/job-1/ch-1/segments/0000.wav",
            1.25,
            "First paragraph.",
        ),
        (
            1,
            "ch-1",
            "p-2",
            1,
            "/media/generated/job-1/ch-1/segments/0001.wav",
            1.25,
            "Second paragraph.",
        ),
    ]


def test_generation_progress_reserves_packaging_tail():
    assert generation_progress(completed_paragraphs=0, total_paragraphs=4) == 0
    assert generation_progress(completed_paragraphs=1, total_paragraphs=4) == 21
    assert generation_progress(completed_paragraphs=4, total_paragraphs=4) == 84


def test_job_runner_updates_progress_and_stream_segments_before_final_packaging(monkeypatch, tmp_path):
    stub_generation_audio_pipeline(monkeypatch, tmp_path)
    book = sample_book()
    saved_jobs: list[GenerateJob] = []

    monkeypatch.setattr("app.jobs.load_book", lambda book_id: book)
    monkeypatch.setattr("app.jobs.load_style", lambda style_id: sample_style())
    monkeypatch.setattr("app.jobs.book_dir", lambda book_id: tmp_path / "books" / book_id)
    monkeypatch.setattr("app.jobs.save_book", lambda saved_book: saved_book)
    monkeypatch.setattr(
        "app.jobs.save_job",
        lambda job: saved_jobs.append(job.model_copy(deep=True)) or job,
    )

    runner = JobRunner(FakeTTS())
    job = GenerateJob(
        id="job-1",
        book_id=book.id,
        status="queued",
        created_at=1,
        updated_at=1,
        message="Queued",
        progress=0,
        chapters=[],
    )
    runner._remember(job)

    runner._run(
        job.id,
        GenerateRequest(
            chapter_ids=["ch-1"],
            style=StyleOverride(style_id="neutral"),
        ),
    )

    progress_updates = [saved.progress for saved in saved_jobs]
    assert 42 in progress_updates
    assert 84 in progress_updates
    assert progress_updates[-1] == 100
    assert [segment.sequence for segment in saved_jobs[-1].stream_segments] == [0, 1]
    assert saved_jobs[-1].stream_segments[0].audio_url.endswith("/segments/0000.wav")


def test_job_runner_batches_stream_segment_persistence(monkeypatch, tmp_path):
    stub_generation_audio_pipeline(monkeypatch, tmp_path)
    book = sample_book(paragraph_count=10)
    saved_jobs: list[GenerateJob] = []

    monkeypatch.setattr("app.jobs.load_book", lambda book_id: book)
    monkeypatch.setattr("app.jobs.load_style", lambda style_id: sample_style())
    monkeypatch.setattr("app.jobs.book_dir", lambda book_id: tmp_path / "books" / book_id)
    monkeypatch.setattr("app.jobs.save_book", lambda saved_book: saved_book)
    monkeypatch.setattr(
        "app.jobs.save_job",
        lambda job: saved_jobs.append(job.model_copy(deep=True)) or job,
    )

    runner = JobRunner(FakeTTS())
    job = GenerateJob(
        id="job-1",
        book_id=book.id,
        status="queued",
        created_at=1,
        updated_at=1,
        message="Queued",
        progress=0,
        chapters=[],
    )
    runner._remember(job)

    runner._run(
        job.id,
        GenerateRequest(
            chapter_ids=["ch-1"],
            style=StyleOverride(style_id="neutral"),
        ),
    )

    stream_progress_saves = [
        saved for saved in saved_jobs if saved.message.startswith("Rendering speech (")
    ]
    assert len(stream_progress_saves) < len(book.chapters[0].paragraphs)
    assert len(saved_jobs[-1].stream_segments) == len(book.chapters[0].paragraphs)


def stub_generation_audio_pipeline(monkeypatch, tmp_path):
    monkeypatch.setattr("app.jobs.file_url", lambda path: "/media/" + Path(path).relative_to(tmp_path).as_posix())
    monkeypatch.setattr("app.jobs.ffmpeg.make_silence", lambda path, duration: path.write_bytes(b"silence"))
    monkeypatch.setattr("app.jobs.ffmpeg.concat_audio", lambda files, output_path: output_path.write_bytes(b"concat"))
    monkeypatch.setattr("app.jobs.ffmpeg.transcode_to_m4a", lambda input_path, output_path: output_path.write_bytes(b"m4a"))
    monkeypatch.setattr("app.jobs.ffmpeg.mux_book_audio", lambda audio_files, subtitles_path, metadata_path, output_path: output_path.write_bytes(b"m4b"))
    monkeypatch.setattr("app.jobs.ffmpeg.write_chapter_metadata", lambda path, title, chapters: path.write_text(title))
    monkeypatch.setattr("app.jobs.ffmpeg.run_ffprobe_duration", lambda path: 1.25 if Path(path).suffix == ".wav" else 2.5)


def sample_book(paragraph_count: int = 2) -> Book:
    return Book(
        id="book-1",
        title="Streaming Book",
        filename="streaming.md",
        created_at=1,
        updated_at=1,
        chapters=[
            Chapter(
                id="ch-1",
                index=0,
                title="Chapter One",
                paragraphs=[
                    sample_paragraph(index) for index in range(paragraph_count)
                ],
            )
        ],
    )


def sample_paragraph(index: int) -> Paragraph:
    if index == 0:
        text = "First paragraph."
    elif index == 1:
        text = "Second paragraph."
    else:
        text = f"Paragraph {index + 1}."
    return Paragraph(
        id=f"p-{index + 1}",
        index=index,
        original_text=text,
        text=text,
    )


def sample_style() -> VoiceStyle:
    return VoiceStyle(
        id="neutral",
        name="Neutral",
        engine="mock",
        voice="default",
        language="en",
    )
