from __future__ import annotations

import re
import time
import uuid
from typing import Iterable, List, Sequence, Tuple

from .models import Book, Chapter, Paragraph


chapter_heading_pattern = re.compile(
    r"^(chapter\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)"
    r"(\b|[:.\-]))|^(prologue|epilogue|part\s+([0-9ivxlcdm]+|\w+)(\b|[:.\-]))",
    re.IGNORECASE,
)
sentence_pattern = re.compile(r"[^.!?;:]+[.!?;:]+[\"')\]]*|[^.!?;:]+$")
max_paragraph_chars = 1200


def normalize_text(input_text: str) -> str:
    text = input_text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def paragraphs_from_text(input_text: str) -> List[str]:
    text = normalize_text(input_text)
    if not text:
        return []

    paragraphs = [clean_paragraph(part) for part in re.split(r"\n{2,}", text)]
    paragraphs = [paragraph for paragraph in paragraphs if paragraph]

    if len(paragraphs) <= 2:
        line_candidates = [clean_paragraph(line) for line in text.split("\n")]
        line_candidates = [line for line in line_candidates if len(line) > 20]
        if len(line_candidates) > len(paragraphs):
            paragraphs = line_candidates

    result: List[str] = []
    for paragraph in paragraphs:
        result.extend(split_long_paragraph(paragraph))
    return result


def split_long_paragraph(paragraph: str) -> List[str]:
    paragraph = clean_paragraph(paragraph)
    if len(paragraph) <= max_paragraph_chars:
        return [paragraph] if paragraph else []

    pieces: List[str] = []
    current = ""
    for sentence in sentence_pattern.findall(paragraph):
        sentence = clean_paragraph(sentence)
        if not sentence:
            continue
        if current and len(current) + len(sentence) + 1 > max_paragraph_chars:
            pieces.append(current)
            current = sentence
        else:
            current = sentence if not current else current + " " + sentence

    if current:
        pieces.append(current)

    if pieces:
        return pieces

    return [paragraph[index : index + max_paragraph_chars].strip() for index in range(0, len(paragraph), max_paragraph_chars)]


def clean_paragraph(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def is_chapter_heading(paragraph: str) -> bool:
    compact = paragraph.strip()
    if not compact or len(compact) > 96:
        return False
    return bool(chapter_heading_pattern.search(compact))


def split_chapters(paragraphs: Sequence[str]) -> List[Tuple[str, List[str]]]:
    chapters: List[Tuple[str, List[str]]] = []
    current_title = "Chapter 1"
    current_paragraphs: List[str] = []
    found_heading = False

    for paragraph in paragraphs:
        if is_chapter_heading(paragraph):
            if current_paragraphs:
                chapters.append((current_title if found_heading else "Front Matter", current_paragraphs))
                current_paragraphs = []
            current_title = paragraph[:90]
            found_heading = True
            continue
        current_paragraphs.append(paragraph)

    if current_paragraphs:
        chapters.append((current_title, current_paragraphs))

    if not chapters and paragraphs:
        chapters.append(("Chapter 1", list(paragraphs)))

    if len(chapters) == 1 and len(chapters[0][1]) > 180:
        return split_large_single_chapter(chapters[0][1])

    return chapters


def split_large_single_chapter(paragraphs: Sequence[str]) -> List[Tuple[str, List[str]]]:
    chapters: List[Tuple[str, List[str]]] = []
    chunk_size = 80
    for index in range(0, len(paragraphs), chunk_size):
        chunk = list(paragraphs[index : index + chunk_size])
        chapters.append((f"Chapter {len(chapters) + 1}", chunk))
    return chapters


def build_book_from_text(title: str, filename: str, text: str) -> Book:
    book_id = uuid.uuid4().hex
    now = time.time()
    paragraphs = paragraphs_from_text(text)
    chapter_groups = split_chapters(paragraphs)
    chapters: List[Chapter] = []

    for chapter_index, (chapter_title, chapter_paragraphs) in enumerate(chapter_groups):
        chapter_id = f"ch-{chapter_index + 1:04d}"
        paragraph_models = [
            Paragraph(
                id=f"{chapter_id}-p-{paragraph_index + 1:04d}",
                index=paragraph_index,
                original_text=paragraph,
                text=paragraph,
                included=True,
            )
            for paragraph_index, paragraph in enumerate(chapter_paragraphs)
        ]
        chapters.append(
            Chapter(
                id=chapter_id,
                index=chapter_index,
                title=chapter_title,
                selected=True,
                paragraphs=paragraph_models,
            )
        )

    return Book(
        id=book_id,
        title=title.strip() or filename.rsplit(".", 1)[0] or "Untitled book",
        filename=filename,
        created_at=now,
        updated_at=now,
        chapters=chapters,
    )


def iter_included_paragraphs(chapter: Chapter) -> Iterable[Paragraph]:
    for paragraph in chapter.paragraphs:
        if paragraph.included and paragraph.text.strip():
            yield paragraph

