"""Phase 0 gate: retrieval quality over a labelled question set.

Metrics:
  - section hit-rate:  expected section_id appears in the top-k hits
  - keyword hit-rate:  expected keyword appears in the concatenated top-k text
  - combined pass:     both of the above

Run:  python eval/test_retrieval.py
Exit code 0 if combined pass-rate >= THRESHOLD, else 1 (usable as a CI gate).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common import EMBED_BACKEND  # noqa: E402
from retriever import retrieve  # noqa: E402

K = 4
# The real Phase-0 quality gate assumes the semantic BGE backend.
# The offline "hashing" fallback is lexical-only (no model download); it can't match
# paraphrased queries, so it runs as a plumbing SMOKE TEST at a lower floor instead.
GATES = {"bge": 0.90, "hashing": 0.70}
THRESHOLD = GATES.get(EMBED_BACKEND, 0.90)
MODE = "SMOKE TEST (lexical)" if EMBED_BACKEND == "hashing" else "QUALITY GATE (semantic)"


def main() -> int:
    cases = json.loads((Path(__file__).parent / "retrieval_questions.json").read_text())
    section_hits = keyword_hits = combined = 0
    failures = []

    for c in cases:
        r = retrieve(c["q"], k=K)
        sections = {h.section_id for h in r.hits}
        blob = " ".join(h.text for h in r.hits).lower()

        sec_ok = c["expect_section"] in sections
        kw_ok = c["expect_keyword"].lower() in blob
        section_hits += sec_ok
        keyword_hits += kw_ok
        both = sec_ok and kw_ok
        combined += both

        if not both:
            failures.append(
                f"  MISS  q={c['q']!r}\n"
                f"        want section={c['expect_section']} (got {sorted(sections)}) "
                f"kw={c['expect_keyword']!r} present={kw_ok} topsim={r.top_score}"
            )

    n = len(cases)
    print(f"Backend: {EMBED_BACKEND}   Mode: {MODE}")
    print(f"Cases: {n}")
    print(f"Section hit-rate:  {section_hits}/{n}  ({section_hits/n:.0%})")
    print(f"Keyword hit-rate:  {keyword_hits}/{n}  ({keyword_hits/n:.0%})")
    print(f"Combined pass:     {combined}/{n}  ({combined/n:.0%})")
    if failures:
        print("\nFailures:")
        print("\n".join(failures))

    passed = combined / n >= THRESHOLD
    print(f"\nGATE: {'PASS' if passed else 'FAIL'} (threshold {THRESHOLD:.0%})")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
