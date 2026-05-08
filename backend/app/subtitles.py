from __future__ import annotations

from dataclasses import dataclass
from html import escape
from typing import Iterable, List


@dataclass
class SubtitleCue:
    start: float
    end: float
    text: str


def write_vtt(path: str, cues: Iterable[SubtitleCue]) -> None:
    lines = ["WEBVTT", ""]
    for cue in cues:
        lines.append(f"{format_vtt_time(cue.start)} --> {format_vtt_time(cue.end)}")
        lines.extend(wrap_subtitle_text(cue.text))
        lines.append("")
    with open(path, "w", encoding="utf-8") as file:
        file.write("\n".join(lines))


def write_srt(path: str, cues: Iterable[SubtitleCue]) -> None:
    lines: List[str] = []
    for index, cue in enumerate(cues, start=1):
        lines.append(str(index))
        lines.append(f"{format_srt_time(cue.start)} --> {format_srt_time(cue.end)}")
        lines.extend(wrap_subtitle_text(cue.text))
        lines.append("")
    with open(path, "w", encoding="utf-8") as file:
        file.write("\n".join(lines))


def offset_cues(cues: Iterable[SubtitleCue], offset_seconds: float) -> List[SubtitleCue]:
    return [
        SubtitleCue(start=cue.start + offset_seconds, end=cue.end + offset_seconds, text=cue.text)
        for cue in cues
    ]


def format_vtt_time(seconds: float) -> str:
    hours, minutes, whole_seconds, milliseconds = split_time(seconds)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{milliseconds:03d}"


def format_srt_time(seconds: float) -> str:
    hours, minutes, whole_seconds, milliseconds = split_time(seconds)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def split_time(seconds: float) -> tuple[int, int, int, int]:
    total_milliseconds = max(0, int(round(seconds * 1000)))
    milliseconds = total_milliseconds % 1000
    total_seconds = total_milliseconds // 1000
    whole_seconds = total_seconds % 60
    total_minutes = total_seconds // 60
    minutes = total_minutes % 60
    hours = total_minutes // 60
    return hours, minutes, whole_seconds, milliseconds


def wrap_subtitle_text(text: str, max_line_length: int = 74) -> List[str]:
    safe_text = escape(" ".join(text.split()), quote=False)
    words = safe_text.split(" ")
    lines: List[str] = []
    current = ""
    for word in words:
        candidate = word if not current else current + " " + word
        if len(candidate) > max_line_length and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]

