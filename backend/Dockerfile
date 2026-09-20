# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    DEEPSEEK_API_KEY="" \
    DEEPSEEK_BASE_URL="https://api.deepseek.com" \
    DEEPSEEK_MODEL="deepseek-flash"

WORKDIR /app

# PDF-to-image fallback and OCR support used by the document extraction routes.
RUN apt-get update \
    && apt-get install --no-install-recommends -y poppler-utils tesseract-ocr \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Install locked production dependencies before copying application code so
# dependency layers remain cached between source-only changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

COPY app ./app

EXPOSE 8000

# Railway supplies PORT at runtime. Set DEEPSEEK_API_KEY and INBOX_BASE_URL as
# Railway service variables; an empty key intentionally disables classification.
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
