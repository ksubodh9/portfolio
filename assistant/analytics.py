"""Lightweight observability for the assistant — telemetry + aggregates.

Every turn records per-stage latency, provider, grounding/refusal, and cache status
into an in-memory ring buffer (and best-effort JSONL). `stats()` computes percentiles
and rates for the /stats endpoint. No PII beyond the (lowercased, truncated) question.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import Counter, deque
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ASSISTANT_DATA_DIR", BASE_DIR / "data"))
LOG_PATH = DATA_DIR / "analytics.jsonl"
MAXLEN = 2000

_turns: deque = deque(maxlen=MAXLEN)
_feedback: deque = deque(maxlen=MAXLEN)
_lock = threading.Lock()


def _append_log(kind: str, rec: dict) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": kind, **rec}, ensure_ascii=False) + "\n")
    except Exception:  # logging must never break a request
        pass


def record_turn(rec: dict) -> None:
    rec = dict(rec)
    rec["ts"] = time.time()
    if rec.get("q"):
        rec["q"] = str(rec["q"]).strip().lower()[:120]
    with _lock:
        _turns.append(rec)
    _append_log("turn", rec)


def record_feedback(rec: dict) -> None:
    rec = dict(rec)
    rec["ts"] = time.time()
    if rec.get("q"):
        rec["q"] = str(rec["q"]).strip().lower()[:120]
    with _lock:
        _feedback.append(rec)
    _append_log("feedback", rec)


def _pct(vals: list[float], p: float):
    if not vals:
        return None
    s = sorted(vals)
    if len(s) == 1:
        return round(s[0], 1)
    k = (len(s) - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return round(s[f] + (s[c] - s[f]) * (k - f), 1)


def stats() -> dict:
    with _lock:
        turns = list(_turns)
        fb = list(_feedback)

    n = len(turns)
    total = [t["total_ms"] for t in turns if t.get("total_ms") is not None]
    ftl = [t["first_token_ms"] for t in turns if t.get("first_token_ms") is not None]
    retr = [t["retrieve_ms"] for t in turns if t.get("retrieve_ms") is not None]
    refused = sum(1 for t in turns if t.get("refused"))
    cached = sum(1 for t in turns if t.get("cache_hit"))
    grounded = sum(1 for t in turns if t.get("grounded"))

    up = sum(1 for f in fb if f.get("rating") == "up")
    down = sum(1 for f in fb if f.get("rating") == "down")

    def rate(x):
        return round(x / n, 3) if n else 0.0

    return {
        "turns": n,
        "refusal_rate": rate(refused),
        "grounded_rate": rate(grounded),
        "cache_hit_rate": rate(cached),
        "latency_ms": {
            "total": {"p50": _pct(total, 50), "p90": _pct(total, 90), "p95": _pct(total, 95)},
            "first_token": {"p50": _pct(ftl, 50), "p90": _pct(ftl, 90)},
            "retrieve": {"p50": _pct(retr, 50), "p90": _pct(retr, 90)},
        },
        "providers": dict(Counter(t.get("provider", "?") for t in turns)),
        "top_questions": Counter(t.get("q") for t in turns if t.get("q")).most_common(10),
        "feedback": {"up": up, "down": down, "total": len(fb)},
    }
