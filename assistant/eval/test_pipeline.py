"""Phase 1 end-to-end test of the /chat SSE pipeline (no API key required).

Uses FastAPI's TestClient and the offline provider chain, so it validates:
  - SSE framing (meta / token / sources / actions / done events)
  - grounded answers cite the right section and surface deep-link actions
  - off-topic questions are refused by the relevance guardrail
  - the provider-fallback path resolves to a working provider

Run:  EMBED_BACKEND=hashing python eval/test_pipeline.py     (offline)
      python eval/test_pipeline.py                            (with BGE + keys)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from server import app  # noqa: E402

client = TestClient(app)


def call(message: str) -> list[dict]:
    events: list[dict] = []
    with client.stream("POST", "/chat", json={"message": message}) as r:
        assert r.status_code == 200, r.status_code
        for line in r.iter_lines():
            if line and line.startswith("data:"):
                events.append(json.loads(line[len("data:") :].strip()))
    return events


def collect_text(events: list[dict]) -> str:
    return "".join(e["text"] for e in events if e["type"] == "token")


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return cond


def main() -> int:
    ok = True

    print("health:")
    h = client.get("/health").json()
    ok &= check("health ok", h.get("status") == "ok", json.dumps(h))

    print("\ngrounded question ('recent GenAI project'):")
    ev = call("Tell me about Subodh's recent GenAI project.")
    types = [e["type"] for e in ev]
    text = collect_text(ev)
    actions = next((e["actions"] for e in ev if e["type"] == "actions"), [])
    sources = next((e["sources"] for e in ev if e["type"] == "sources"), [])
    ok &= check("emits meta+token+sources+actions+done",
                {"meta", "token", "sources", "actions", "done"} <= set(types), str(set(types)))
    ok &= check("answer is non-empty", len(text.strip()) > 0, f"{len(text)} chars")
    ok &= check("has >=1 source", len(sources) >= 1, f"{len(sources)} sources")
    ok &= check("has a scroll_to_section action",
                any(a["type"] == "scroll_to_section" for a in actions), str(actions))

    print("\nhiring question -> should offer résumé action:")
    ev = call("Why would Subodh be a good fit for an AI Engineer role?")
    actions = next((e["actions"] for e in ev if e["type"] == "actions"), [])
    ok &= check("offers résumé action",
                any(a["type"] == "open_resume" for a in actions), str([a["type"] for a in actions]))

    print("\noff-topic question -> should refuse:")
    ev = call("What is the weather in Paris today?")
    text = collect_text(ev).lower()
    meta = next((e for e in ev if e["type"] == "meta"), {})
    refused = ("don't have that information" in text) or (meta.get("grounded") is False)
    ok &= check("refuses off-topic", refused, text[:80])

    print("\nempty message -> 422 validation:")
    r = client.post("/chat", json={"message": ""})
    ok &= check("rejects empty", r.status_code == 422, str(r.status_code))

    print(f"\nRESULT: {'ALL PASS' if ok else 'FAILURES ABOVE'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
