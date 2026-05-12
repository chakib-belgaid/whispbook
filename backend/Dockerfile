FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV WHISPBOOK_STORAGE=/app/storage
ENV UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.9.12 /uv /uvx /bin/

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg espeak-ng libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock /app/
RUN uv sync --frozen --no-dev

COPY app /app/app

EXPOSE 8000

CMD ["uv", "run", "--frozen", "--no-dev", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
