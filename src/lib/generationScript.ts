import type { Book, StyleOverride } from "../types";

type ExportLocation = Pick<
  Location,
  "hostname" | "origin" | "port" | "protocol"
>;

interface GenerationScriptOptions {
  defaultApiUrl?: string;
  exportedAt?: string;
}

interface GenerationRequestSnapshot {
  chapter_ids: string[];
  style: StyleOverride;
  subtitle_source: "edited";
}

export function selectedGenerationChapterIds(book: Book): string[] {
  return book.chapters
    .filter((chapter) => chapter.selected)
    .map((chapter) => chapter.id);
}

export function buildBookPatchSnapshot(book: Book) {
  return {
    title: book.title,
    cast: book.cast,
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      selected: chapter.selected,
      paragraphs: chapter.paragraphs.map((paragraph) => ({
        id: paragraph.id,
        text: paragraph.text,
        included: paragraph.included,
        voice_ranges: paragraph.voice_ranges,
      })),
    })),
  };
}

export function buildGenerationRequestSnapshot(
  book: Book,
  style: StyleOverride,
): GenerationRequestSnapshot {
  const chapterIds = selectedGenerationChapterIds(book);
  if (chapterIds.length === 0) {
    throw new Error("Select at least one chapter.");
  }

  return {
    chapter_ids: chapterIds,
    style: {
      ...style,
      style_id: style.style_id || "neutral",
    },
    subtitle_source: "edited",
  };
}

export function buildGenerationScript(
  book: Book,
  style: StyleOverride,
  options: GenerationScriptOptions = {},
): string {
  const generationRequest = buildGenerationRequestSnapshot(book, style);
  const selectedChapters = book.chapters.filter((chapter) =>
    generationRequest.chapter_ids.includes(chapter.id),
  );
  const metadata = {
    exported_at: options.exportedAt ?? new Date().toISOString(),
    book_id: book.id,
    book_title: book.title,
    total_chapters: book.chapters.length,
    selected_chapter_count: selectedChapters.length,
    selected_chapters: selectedChapters.map((chapter) => ({
      id: chapter.id,
      index: chapter.index,
      title: chapter.title,
      included_paragraphs: chapter.paragraphs.filter(
        (paragraph) => paragraph.included,
      ).length,
    })),
    tts: generationRequest.style,
  };

  const defaultApiUrl = options.defaultApiUrl ?? "http://127.0.0.1:8000";
  const bookPatchB64 = encodeJsonPayload(buildBookPatchSnapshot(book));
  const generationRequestB64 = encodeJsonPayload(generationRequest);
  const metadataB64 = encodeJsonPayload(metadata);

  return `#!/usr/bin/env python3
"""Run a Whispbook audiobook generation job exported from the UI.

This script patches the backend with the exported UI edits, starts the
background generation job, and polls until the backend reports completion.
Use --detach to start the backend job and exit immediately.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BOOK_ID = ${JSON.stringify(book.id)}
DEFAULT_API_URL = ${JSON.stringify(defaultApiUrl)}
BOOK_PATCH_B64 = "${bookPatchB64}"
GENERATE_REQUEST_B64 = "${generationRequestB64}"
EXPORT_METADATA_B64 = "${metadataB64}"
TERMINAL_STATES = {"done", "error"}


def decode_payload(value: str) -> dict:
    return json.loads(base64.b64decode(value.encode("ascii")).decode("utf-8"))


def api_path(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def request_json(method: str, base_url: str, path: str, payload: dict | None = None) -> dict | None:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(api_path(base_url, path), data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Cannot reach Whispbook backend at {base_url}: {error.reason}") from error

    if not body:
        return None
    return json.loads(body)


def summarize_tts(style: dict) -> str:
    fields = [
        "engine",
        "voice",
        "language",
        "speed",
        "exaggeration",
        "cfg_weight",
        "temperature",
        "top_p",
        "paragraph_gap_ms",
        "prompt_prefix",
    ]
    parts = []
    for field in fields:
        value = style.get(field)
        if value not in (None, ""):
            parts.append(f"{field}={value!r}")
    return ", ".join(parts)


def summarize_chapters(chapters: list[dict]) -> str:
    counts: dict[str, int] = {}
    for chapter in chapters:
        status = str(chapter.get("status", "unknown"))
        counts[status] = counts.get(status, 0) + 1
    return ", ".join(f"{status}:{counts[status]}" for status in sorted(counts))


def job_snapshot(job: dict) -> str:
    progress = round(float(job.get("progress") or 0))
    chapter_summary = summarize_chapters(job.get("chapters") or [])
    message = job.get("error") or job.get("message") or ""
    if chapter_summary:
        return f"{job.get('status')} {progress}% - {message} ({chapter_summary})"
    return f"{job.get('status')} {progress}% - {message}"


def absolute_url(base_url: str, value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith(("http://", "https://")):
        return value
    return api_path(base_url, value)


def run(args: argparse.Namespace) -> int:
    api_url = args.api_url.rstrip("/")
    book_patch = decode_payload(BOOK_PATCH_B64)
    generation_request = decode_payload(GENERATE_REQUEST_B64)
    metadata = decode_payload(EXPORT_METADATA_B64)

    print(f"Whispbook export: {metadata['book_title']}")
    print(f"Book id: {BOOK_ID}")
    print(f"Selected chapters: {metadata['selected_chapter_count']} of {metadata['total_chapters']}")
    print(f"TTS: {summarize_tts(metadata['tts'])}")

    if args.skip_save:
        print("Skipping book patch; using the backend's current book state.")
    else:
        request_json("PATCH", api_url, f"/api/books/{BOOK_ID}", book_patch)
        print("Saved exported UI edits to backend.")

    job = request_json("POST", api_url, f"/api/books/{BOOK_ID}/generate", generation_request)
    if job is None:
        raise RuntimeError("Backend returned an empty generation response.")

    job_id = job["id"]
    print(f"Started job: {job_id}")
    if args.detach:
        print(f"Detached. Poll with: {api_path(api_url, '/api/jobs/' + job_id)}")
        return 0

    last_snapshot = None
    while True:
        snapshot = job_snapshot(job)
        if snapshot != last_snapshot:
            print(snapshot, flush=True)
            last_snapshot = snapshot
        if job.get("status") in TERMINAL_STATES:
            break
        time.sleep(args.poll_interval)
        polled = request_json("GET", api_url, f"/api/jobs/{job_id}")
        if polled is not None:
            job = polled

    if job.get("status") == "error":
        print(f"Generation failed: {job.get('error') or job.get('message')}", file=sys.stderr)
        return 1

    print("Audiobook ready:")
    for label, key in [
        ("M4B", "final_audio_url"),
        ("VTT", "final_vtt_url"),
        ("SRT", "final_srt_url"),
    ]:
        url = absolute_url(api_url, job.get(key))
        if url:
            print(f"  {label}: {url}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Start a Whispbook generation job from an exported UI snapshot.")
    parser.add_argument("--api-url", default=os.environ.get("WHISPBOOK_API_URL", DEFAULT_API_URL))
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--detach", action="store_true", help="start the backend job and exit without polling")
    parser.add_argument("--skip-save", action="store_true", help="do not PATCH the exported book edits before starting")
    args = parser.parse_args()

    try:
        return run(args)
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType: string,
): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function generationScriptFilename(
  book: Book,
  exportedAt: Date = new Date(),
): string {
  const stamp = exportedAt.toISOString().replace(/[:.]/g, "-");
  return `whispbook-${safeFilenamePart(book.title)}-${stamp}.py`;
}

export function defaultBackendUrlFromLocation(
  location: ExportLocation,
): string {
  if (location.port === "5173") {
    return `${location.protocol}//${location.hostname}:8000`;
  }
  return location.origin;
}

function encodeJsonPayload(payload: unknown): string {
  return encodeBase64Utf8(JSON.stringify(payload, null, 2));
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function safeFilenamePart(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 64) || "audiobook";
}
