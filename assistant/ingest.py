"""Ingestion: read knowledge markdown -> chunk -> embed (BGE) -> Chroma index.

Run:  python ingest.py
Re-run any time the knowledge/ files change. It rebuilds the collection from scratch.
"""
from __future__ import annotations

import shutil

from common import (
    CHROMA_DIR,
    COLLECTION_NAME,
    KNOWLEDGE_DIR,
    chroma_client,
    chunk_markdown,
    embed,
    load_manifest,
)


def build() -> int:
    manifest = load_manifest()

    # Fresh build — Chroma has no clean "recreate", so wipe the dir.
    if CHROMA_DIR.exists():
        shutil.rmtree(CHROMA_DIR)
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    client = chroma_client()
    collection = client.create_collection(
        name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"}
    )

    ids: list[str] = []
    docs: list[str] = []
    metas: list[dict] = []

    for entry in manifest["documents"]:
        md = (KNOWLEDGE_DIR / entry["file"]).read_text(encoding="utf-8")
        chunks = chunk_markdown(md)
        for i, ch in enumerate(chunks):
            ids.append(f"{entry['file']}::{i}")
            docs.append(ch["text"])
            metas.append(
                {
                    "source": entry["source"],
                    "section_id": entry["section_id"],
                    "url": entry["url"],
                    "heading": ch["heading"],
                }
            )

    print(f"Embedding {len(docs)} chunks with BGE...")
    vectors = embed(docs)
    collection.add(ids=ids, documents=docs, metadatas=metas, embeddings=vectors)

    print(f"Indexed {collection.count()} chunks into '{COLLECTION_NAME}' at {CHROMA_DIR}")
    return collection.count()


if __name__ == "__main__":
    build()
