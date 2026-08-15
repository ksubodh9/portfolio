# Portfolio AI Assistant — backend image
# Bakes the embedding model + vector index into the image at build time so cold
# starts are instant (important on free-tier hosts like Render/Fly).
FROM python:3.11-slim

# --- runtime env ---
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    FASTEMBED_CACHE=/app/.fastembed_cache \
    ANONYMIZED_TELEMETRY=False

WORKDIR /app

# --- python deps (cached layer) ---
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- app code ---
COPY . .

# --- build the index (downloads BGE into the image cache) ---
# Override to skip model download in air-gapped CI:  --build-arg EMBED_BACKEND=hashing
ARG EMBED_BACKEND=bge
ENV EMBED_BACKEND=${EMBED_BACKEND}
RUN python ingest.py

# --- run as non-root ---
RUN useradd -m app && chown -R app:app /app
USER app

EXPOSE 8000
# Honor $PORT (Render/Fly inject it); default 8000 locally.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
