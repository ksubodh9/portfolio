"""Grounded prompt construction, refusal handling, and citation/action derivation.

The grounding contract: the assistant answers ONLY from retrieved context. If the
context doesn't support an answer, it refuses instead of inventing facts. This is the
core hallucination control for a portfolio that recruiters will actually read.
"""
from __future__ import annotations

from retriever import Retrieval

# Portfolio deep-link targets (section_id -> human label). Used to turn cited
# sections into navigation "actions" the frontend can act on (scroll / highlight).
SECTION_LABELS = {
    "about": "About",
    "experience": "Experience",
    "skills": "Skills",
    "projects": "Projects",
}

RESUME_URL = (
    "https://ksubodh9.github.io/portfolio/"
    "resources/resumes/Subodh_Kumar_GenAI_Engineer_Resume.pdf"
)

REFUSAL_TEXT = (
    "I don't have that information about Subodh in his portfolio. "
    "I can tell you about his experience, skills, and projects — "
    "for example his RAG work, his ML systems, or his fintech backend engineering."
)

SYSTEM_PROMPT = """You are the AI assistant on Subodh Kumar's portfolio website. \
You answer questions from visitors (often recruiters) about Subodh's professional \
background.

Rules:
- Answer ONLY using the CONTEXT below. Never invent facts, employers, dates, numbers, \
titles, or projects. If the answer is not in the CONTEXT, say you don't have that \
information about Subodh and offer what you can help with instead.
- Speak about Subodh in the third person ("Subodh built...", "He has...").
- Be warm, concise, and professional. Default to 2-4 sentences; expand only if the \
question clearly asks for depth.
- When a project or section is relevant, mention it by name so the visitor knows where \
to look on the portfolio.
- Only discuss Subodh's professional background. Politely decline unrelated questions.
- Do not use markdown headings or bullet lists; reply in short natural prose."""


def build_messages(query: str, retrieval: Retrieval) -> tuple[str, str]:
    """Return (system_prompt, user_content) for the LLM."""
    context = retrieval.context_block()
    user = f"CONTEXT:\n{context}\n\nVISITOR QUESTION: {query}\n\nAnswer:"
    return SYSTEM_PROMPT, user


def derive_actions(retrieval: Retrieval, query: str) -> list[dict]:
    """Turn retrieved sections into frontend navigation actions (deep-linking).

    This is the deterministic 'tool' layer for Phase 1: instead of asking the LLM to
    emit function calls, we surface reliable scroll-to-section + resume actions from the
    cited sources. (LLM-native function calling is a V2 upgrade.)
    """
    actions: list[dict] = []
    seen = set()
    for h in retrieval.hits:
        sid = h.section_id
        if sid and sid not in seen and sid in SECTION_LABELS:
            seen.add(sid)
            actions.append(
                {
                    "type": "scroll_to_section",
                    "section_id": sid,
                    "label": f"See {SECTION_LABELS[sid]}",
                    "url": h.url,
                }
            )

    q = query.lower()
    if any(w in q for w in ("resume", "cv", "hire", "fit", "role", "experience", "contact")):
        actions.append(
            {"type": "open_resume", "label": "View résumé", "url": RESUME_URL}
        )
    return actions[:4]


def cite_sources(retrieval: Retrieval) -> list[dict]:
    """Compact, de-duplicated source list for display under an answer."""
    out, seen = [], set()
    for h in retrieval.hits:
        key = (h.source, h.heading)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {"source": h.source, "heading": h.heading, "url": h.url, "score": h.score}
        )
    return out
