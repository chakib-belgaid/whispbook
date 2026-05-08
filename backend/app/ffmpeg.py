from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable, List


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def run_ffmpeg(args: List[str]) -> None:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg failed")


def run_ffprobe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    return float(result.stdout.strip())


def make_silence(path: Path, duration_seconds: float, sample_rate: int = 24000) -> None:
    run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=r={sample_rate}:cl=mono",
            "-t",
            f"{duration_seconds:.3f}",
            "-acodec",
            "pcm_s16le",
            str(path),
        ]
    )


def normalize_wav(input_path: Path, output_path: Path, sample_rate: int = 24000) -> None:
    run_ffmpeg(["-i", str(input_path), "-ac", "1", "-ar", str(sample_rate), "-sample_fmt", "s16", str(output_path)])


def concat_audio(files: Iterable[Path], output_path: Path) -> None:
    file_list = output_path.with_suffix(".concat.txt")
    write_concat_file(file_list, files)
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(file_list), "-c", "copy", str(output_path)])


def transcode_to_m4a(input_path: Path, output_path: Path, bitrate: str = "128k") -> None:
    run_ffmpeg(["-i", str(input_path), "-vn", "-c:a", "aac", "-b:a", bitrate, str(output_path)])


def mux_book_audio(
    chapter_audio_files: List[Path],
    srt_path: Path,
    metadata_path: Path,
    output_path: Path,
    bitrate: str = "128k",
) -> None:
    concat_file = output_path.with_suffix(".chapters.txt")
    write_concat_file(concat_file, chapter_audio_files)
    run_ffmpeg(
        [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-i",
            str(srt_path),
            "-i",
            str(metadata_path),
            "-map",
            "0:a",
            "-map",
            "1:0",
            "-map_metadata",
            "2",
            "-c:a",
            "aac",
            "-b:a",
            bitrate,
            "-c:s",
            "mov_text",
            str(output_path),
        ]
    )


def write_concat_file(path: Path, files: Iterable[Path]) -> None:
    lines = []
    for file_path in files:
        escaped = str(file_path.resolve()).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_chapter_metadata(path: Path, title: str, chapters: List[tuple[str, float, float]]) -> None:
    lines = [";FFMETADATA1", f"title={escape_metadata(title)}"]
    for chapter_title, start, end in chapters:
        lines.extend(
            [
                "[CHAPTER]",
                "TIMEBASE=1/1000",
                f"START={int(round(start * 1000))}",
                f"END={int(round(end * 1000))}",
                f"title={escape_metadata(chapter_title)}",
            ]
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def escape_metadata(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace("=", "\\=").replace(";", "\\;")

