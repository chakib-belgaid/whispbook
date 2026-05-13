FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV WHISPBOOK_STORAGE=/app/storage
ENV UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.9.12 /uv /uvx /bin/

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg espeak-ng libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml backend/uv.lock /app/
RUN uv sync --frozen --no-dev

COPY backend/app /app/app
COPY voice_styles /app/voice_styles

EXPOSE 8000

CMD ["uv", "run", "--frozen", "--no-dev", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
