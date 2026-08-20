"""Hybrid retrieval: always-on core facts card + vector top-k over the KB.

The core card guarantees basic identity questions never depend on retrieval,
while vector search handles depth (projects, experience, skills). Every hit
carries source/section_id/url metadata so answers can cite and deep-link.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from common import COLLECTION_NAME, chroma_client, embed_one, load_profile


@dataclass
class Hit:
    text: str
    source: str
    section_id: str
    url: str
    heading: str
    score: float  # cosine similarity in [0, 1]; higher = closer


@dataclass
class Retrieval:
    core_card: str
    hits: list[Hit] = field(default_factory=list)

    @property
    def top_score(self) -> float:
        return self.hits[0].score if self.hits else 0.0

    def context_block(self) -> str:
        """Formatted context to drop into an LLM prompt (Phase 1 will use this)."""
        parts = [f"[CORE FACTS]\n{self.core_card}"]
        for i, h in enumerate(self.hits, 1):
            parts.append(f"[{i}] source: {h.source} ({h.url})\n{h.text}")
        return "\n\n".join(parts)


@lru_cache(maxsize=1)
def _collection():
    return chroma_client().get_collection(COLLECTION_NAME)


@lru_cache(maxsize=256)
def _query_vec(query: str) -> tuple:
    """Cache query embeddings — repeat/FAQ questions skip re-embedding."""
    return tuple(embed_one(query))


@lru_cache(maxsize=1)
def _core_card() -> str:
    p = load_profile()
    skills = "; ".join(f"{k}: {', '.join(v)}" for k, v in p["top_skills"].items())
    return (
        f"Name: {p['name']}. Role: {p['headline']}. {p['one_liner']} "
        f"Location: {p['location']}. Email: {p['email']}. "
        f"GitHub: {p['links']['github']}. LinkedIn: {p['links']['linkedin']}. "
        f"Availability: {p['availability']} "
        f"Current role: {p['current_role']}. "
        f"Experience: {p['experience_years']} years. "
        f"Focus areas: {'; '.join(p['focus_areas'])}. "
        f"Skills — {skills}. "
        f"Achievements: {'; '.join(p['headline_achievements'])}."
    )


def retrieve(query: str, k: int = 4) -> Retrieval:
    vec = list(_query_vec(query))
    res = _collection().query(
        query_embeddings=[vec],
        n_results=k,
        include=["documents", "metadatas", "distances"],
    )
    hits: list[Hit] = []
    # An empty/unbuilt collection returns [[]]; metadatas comes back None when no
    # metadata was stored. Both used to raise here and 500 the whole turn.
    docs = (res.get("documents") or [[]])[0] or []
    metas = (res.get("metadatas") or [[]])[0] or [{}] * len(docs)
    dists = (res.get("distances") or [[]])[0] or [1.0] * len(docs)
    for doc, meta, dist in zip(docs, metas, dists):
        meta = meta or {}
        hits.append(
            Hit(
                text=doc,
                source=meta.get("source", ""),
                section_id=meta.get("section_id", ""),
                url=meta.get("url", ""),
                heading=meta.get("heading", ""),
                score=round(1.0 - float(dist), 4),  # cosine distance -> similarity
            )
        )
    return Retrieval(core_card=_core_card(), hits=hits)


if __name__ == "__main__":
    import sys

    q = " ".join(sys.argv[1:]) or "Tell me about Subodh's recent GenAI project."
    r = retrieve(q)
    print(f"Q: {q}\n")
    print(f"top score: {r.top_score}\n")
    for i, h in enumerate(r.hits, 1):
        print(f"[{i}] {h.source} · {h.heading} · sim={h.score} · {h.url}")
        print(f"    {h.text[:140].replace(chr(10), ' ')}...\n")
