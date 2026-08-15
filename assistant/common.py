"""Shared knowledge-base config, embedder, and chunking for the portfolio assistant.

Phase 0 — knowledge layer. Uses FastEmbed (BGE, ONNX) to match the DocIntel stack,
and a persistent Chroma collection as the vector store.
"""
from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

# Chroma's bundled telemetry has a noisy signature bug in some versions; silence it.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
logging.getLogger("chromadb.telemetry").setLevel(logging.CRITICAL)
logging.getLogger("chromadb.telemetry.product.posthog").setLevel(logging.CRITICAL)

BASE_DIR = Path(__file__).resolve().parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge"
# Vector store location. Override with ASSISTANT_DATA_DIR when the repo lives on a
# network/mounted filesystem where SQLite file locking fails (e.g. some VMs).
DATA_DIR = Path(os.environ.get("ASSISTANT_DATA_DIR", BASE_DIR / "data"))
CHROMA_DIR = DATA_DIR / "chroma"
COLLECTION_NAME = "portfolio_kb"

# Small, fast, ~130MB. Same BGE family used in DocIntel / LaraOpsCopilot.
EMBED_MODEL = "BAAI/bge-small-en-v1.5"

# Embedding backend:
#   "bge"     -> FastEmbed BGE (semantic, production default; needs model download)
#   "hashing" -> offline HashingVectorizer fallback (no download; for CI/sandbox
#                where Hugging Face is unreachable). Lexical, not semantic.
# Set EMBED_BACKEND=hashing to force the offline path.
EMBED_BACKEND = os.environ.get("EMBED_BACKEND", "bge")
HASHING_DIM = 2048

# Chunking knobs — the KB is small, so keep chunks section-sized with light overlap.
MAX_CHARS = 900
OVERLAP_CHARS = 150


@lru_cache(maxsize=1)
def get_embedder():
    """Lazy singleton FastEmbed BGE model (downloads once, then cached).

    Cache dir is configurable so a Docker build can bake the model into an image
    layer (download at build time -> instant cold starts at runtime).
    """
    from fastembed import TextEmbedding

    cache_dir = os.environ.get("FASTEMBED_CACHE", str(BASE_DIR / ".fastembed_cache"))
    return TextEmbedding(model_name=EMBED_MODEL, cache_dir=cache_dir)


@lru_cache(maxsize=1)
def _hashing_vectorizer():
    from sklearn.feature_extraction.text import HashingVectorizer

    # Stateless (no fit needed), L2-normalized, word n-grams. Drop English stopwords
    # so off-topic queries ("weather in paris today") don't match on filler words —
    # which lets the relevance gate separate them from real portfolio questions.
    return HashingVectorizer(
        n_features=HASHING_DIM,
        ngram_range=(1, 2),
        norm="l2",
        alternate_sign=False,
        stop_words="english",
    )


def embed(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts -> list of float vectors, using the active backend."""
    if EMBED_BACKEND == "hashing":
        return _hashing_vectorizer().transform(texts).toarray().tolist()
    return [vec.tolist() for vec in get_embedder().embed(texts)]


def embed_one(text: str) -> list[float]:
    return embed([text])[0]


def chroma_client():
    """PersistentClient with telemetry disabled (avoids noisy stderr)."""
    import chromadb
    from chromadb.config import Settings

    return chromadb.PersistentClient(
        path=str(CHROMA_DIR), settings=Settings(anonymized_telemetry=False)
    )


def load_manifest() -> dict:
    return json.loads((KNOWLEDGE_DIR / "manifest.json").read_text(encoding="utf-8"))


def load_profile() -> dict:
    return json.loads((KNOWLEDGE_DIR / "profile.json").read_text(encoding="utf-8"))


def _split_long(text: str) -> list[str]:
    """Split an over-long block into overlapping windows on sentence-ish boundaries."""
    if len(text) <= MAX_CHARS:
        return [text]
    parts, start = [], 0
    while start < len(text):
        end = min(start + MAX_CHARS, len(text))
        # try not to cut mid-sentence
        if end < len(text):
            dot = text.rfind(". ", start + MAX_CHARS - OVERLAP_CHARS, end)
            if dot != -1:
                end = dot + 1
        parts.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - OVERLAP_CHARS, start + 1)
    return [p for p in parts if p]


def chunk_markdown(md: str) -> list[dict]:
    """Chunk a markdown doc by ## headings, keeping the heading as context.

    Returns list of {heading, text}.
    """
    lines = md.splitlines()
    chunks: list[dict] = []
    doc_title = ""
    heading = ""
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        if not body:
            return
        prefix = f"{doc_title} — {heading}".strip(" —") if heading else doc_title
        for piece in _split_long(body):
            text = f"[{prefix}]\n{piece}" if prefix else piece
            chunks.append({"heading": heading or doc_title, "text": text})

    for line in lines:
        if line.startswith("# ") and not line.startswith("## "):
            doc_title = line[2:].strip()
        elif line.startswith("## "):
            flush()
            buf = []
            heading = line[3:].strip()
        else:
            buf.append(line)
    flush()
    return chunks
