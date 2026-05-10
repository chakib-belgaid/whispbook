# Whispbook

[![CI](https://github.com/chakib-belgaid/whispbook/actions/workflows/ci.yml/badge.svg)](https://github.com/chakib-belgaid/whispbook/actions/workflows/ci.yml)
[![Release Validation](https://github.com/chakib-belgaid/whispbook/actions/workflows/release.yml/badge.svg)](https://github.com/chakib-belgaid/whispbook/actions/workflows/release.yml)

Whispbook is a self-hosted audiobook studio for turning selectable-text documents into mobile-friendly audiobook files with chapter audio and subtitles.

## Features

- Document import with automatic chapter and paragraph extraction.
- Chapter selection before generation.
- Paragraph cleanup with edit, exclude, and mark controls.
- Narration presets for neutral, fantasy, sci-fi, murder mystery, and nonfiction.
- Custom style import through JSON parameters and optional reference audio.
- Single-paragraph preview before rendering the full book.
- Exportable generation scripts that snapshot UI edits, selected chapters, and TTS settings.
- Background generation with per-chapter status.
- Per-chapter `.m4a` audio plus `.vtt` and `.srt` subtitles.
- Final `.m4b` audiobook with embedded `mov_text` subtitles, chapter metadata, and sidecar `.vtt`/`.srt`.

## Requirements

- Node.js 20 or newer.
- Python 3.10 or newer. Chatterbox requires Python 3.10+.
- `ffmpeg` and `ffprobe`.
- `espeak-ng` for Kokoro.

## Model downloads

Whispbook loads Kokoro, Chatterbox, and Chatterbox Turbo weights from Hugging Face and stores them in the standard Hugging Face cache (`~/.cache/huggingface/hub` by default). The first preview or generation will download missing files lazily, but you can warm the cache ahead of time:

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python - <<'PY'
from huggingface_hub import snapshot_download
import os

downloads = [
    (
        "Kokoro",
        "hexgrad/Kokoro-82M",
        ["config.json", "kokoro-v1_0.pth", "voices/*.pt"],
    ),
    (
        "Chatterbox",
        "ResembleAI/chatterbox",
        ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"],
    ),
    (
        "Chatterbox Turbo",
        "ResembleAI/chatterbox-turbo",
        ["*.safetensors", "*.json", "*.txt", "*.pt", "*.model"],
    ),
]

for label, repo_id, allow_patterns in downloads:
    path = snapshot_download(
        repo_id=repo_id,
        allow_patterns=allow_patterns,
        token=os.getenv("HF_TOKEN") or None,
    )
    print(f"{label}: {path}")
PY
```

Set `HF_HOME=/path/to/cache` before running the command if you want to store the models somewhere other than the default Hugging Face cache.

The current machine has Python 3.8.10, so use Python 3.10+ or Docker for the backend.
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

## Local Development

Install frontend dependencies:

```bash
npm install
```

Create and run the backend with Python 3.10+:

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run the frontend in another terminal:

```bash
npm run dev
```

Open `http://localhost:5173`.

## CI/CD

Pull requests to `master` or `main` and pushes to `master` or `main` run the CI workflow with separate frontend and backend jobs. The frontend job checks formatting, lints, runs Vitest, and builds the Vite app. The backend job runs Ruff and the pytest suite through `uv` so logs point at either Python quality issues or failing tests.

Release validation is intentionally separate from PR checks. It runs only for manual dispatches or version tags (`v*`) and adds a backend Docker image build on top of the normal frontend and backend validation.

Run the same checks locally before publishing changes:

```bash
npm run format:check
npm run lint
npm test
npm run build
uv run --with ruff --with-requirements backend/requirements.txt ruff check backend/app backend/tests
uv run --with pytest --with-requirements backend/requirements.txt pytest backend/tests
```

## Document import

Whispbook uses Microsoft MarkItDown to convert uploaded local documents into Markdown before chapter and paragraph extraction. Supported imports are PDF, DOCX, PPTX, XLS, XLSX, EPUB, HTML, TXT, Markdown, CSV, JSON, and XML.

Imports are local uploads only. URL import, ZIP import, audio/video transcription, image OCR, Azure Document Intelligence, and MarkItDown plugins are not enabled. Scanned PDFs or image-only documents need selectable text unless MarkItDown can extract useful text without OCR.

## Exported generation scripts

Use **Export script** in the Audiobook panel to download a Python script for the current voice settings. The script includes:

- Current book edits and paragraph inclusion flags.
- Selected chapter IDs.
- TTS engine, voice, language, and generation parameters.

Run it while the backend is up:

```bash
python whispbook-your-book-*.py
```

Pass `--detach` to start the backend job and exit without polling, or `--api-url http://host:8000` when the backend is not on the exported default URL.

## Docker

```bash
docker compose up --build
```

The frontend runs on `http://localhost:5173` and the API on `http://localhost:8000`.

## Style JSON

Custom style JSON can include:

```json
{
  "description": "Slow dramatic narration",
  "voice": "af_heart",
  "language": "en",
  "speed": 0.95,
  "exaggeration": 0.7,
  "cfg_weight": 0.35,
  "temperature": 0.85,
  "top_p": 0.95,
  "paragraph_gap_ms": 650,
  "prompt_prefix": "[deep breath] "
}
```

For Chatterbox styles, upload a 5-10 second reference clip when you want the style to follow a known external voice or narration sample.
