# Whispbook

Whispbook is a self-hosted audiobook studio for turning selectable-text PDFs into mobile-friendly audiobook files with chapter audio and subtitles.

## Features

- PDF import with automatic chapter and paragraph extraction.
- Chapter selection before generation.
- Paragraph cleanup with edit, exclude, and restore controls.
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

## Exported generation scripts

Use **Export script** in the Style panel to download a Python script for the current UI configuration. The script includes:

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
