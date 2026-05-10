# Whispbook

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
