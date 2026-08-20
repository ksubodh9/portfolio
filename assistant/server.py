"""FastAPI backend for the portfolio assistant — Phase 1.

Flow per turn:
  moderate/relevance-gate -> retrieve -> grounded prompt -> stream LLM (with fallback)
  -> emit tokens + sources + navigation actions over SSE.

Run:  uvicorn server:app --reload --port 8000
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from collections import OrderedDict, defaultdict, deque
from contextlib import asynccontextmanager

# Load .env so `uvicorn server:app` picks up keys without Docker/manual export.
try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # dotenv optional
    pass

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import analytics
from common import EMBED_BACKEND
from llm import stream_answer
from prompt import REFUSAL_TEXT, build_messages, cite_sources, derive_actions
from retriever import retrieve

# ------------------------------ config ------------------------------------- #
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://ksubodh9.github.io,http://localhost:5173,http://127.0.0.1:5173",
).split(",")
RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "15"))
DAILY_CAP = int(os.environ.get("DAILY_CAP", "500"))  # crude spend cap / kill switch
MAX_MESSAGE_CHARS = int(os.environ.get("MAX_MESSAGE_CHARS", "500"))
TOP_K = int(os.environ.get("TOP_K", "4"))
# Relevance gate: below this top similarity, refuse without spending an LLM call.
# Absolute scores differ by backend (lexical hashing scores run much lower than BGE
# cosine), so the default floor is backend-specific; override with MIN_RELEVANCE.
_REL_DEFAULT = "0.08" if EMBED_BACKEND == "hashing" else "0.30"
MIN_RELEVANCE = float(os.environ.get("MIN_RELEVANCE", _REL_DEFAULT))

# --- ElevenLabs TTS (optional; frontend falls back to browser TTS if unset) ---
ELEVEN_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
# Well-known public voice (Rachel) — used as default and as a safety fallback.
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"
ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE).strip() or DEFAULT_VOICE
ELEVEN_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_flash_v2_5").strip()
TTS_MAX_CHARS = int(os.environ.get("TTS_MAX_CHARS", "400"))
TTS_ENABLED = bool(ELEVEN_KEY and ELEVEN_VOICE)
if TTS_ENABLED:
    print(f"[assistant] ElevenLabs TTS enabled (voice={ELEVEN_VOICE}, model={ELEVEN_MODEL})")
else:
    print("[assistant] ElevenLabs TTS disabled (no ELEVENLABS_API_KEY) — using browser TTS")


@asynccontextmanager
async def lifespan(app):
    # Warm the embedder + Chroma collection + core card so the first real request
    # doesn't pay the cold-start cost.
    try:
        retrieve("warmup", k=1)
    except Exception:  # noqa: BLE001
        pass
    yield

# --- caching (latency + cost) ---
CACHE_TTL = int(os.environ.get("CACHE_TTL", "3600"))   # response cache freshness (s)
CACHE_MAX = int(os.environ.get("CACHE_MAX", "200"))
TTS_CACHE_MAX = int(os.environ.get("TTS_CACHE_MAX", "128"))
STATS_TOKEN = os.environ.get("STATS_TOKEN", "")        # optional gate for /stats

app = FastAPI(title="Portfolio Assistant", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ------------------------------ rate limiting ------------------------------ #
_hits: dict[str, deque] = defaultdict(deque)
_day = {"date": time.strftime("%Y-%m-%d"), "count": 0}


def _sweep_hits(now: float) -> None:
    """Drop IP buckets with no hits in the last minute.

    Without this, `_hits` accumulates one deque per unique client IP for the
    lifetime of the process — a slow leak on a public endpoint.
    """
    stale = [k for k, v in _hits.items() if not v or now - v[-1] > 60]
    for k in stale:
        _hits.pop(k, None)


def _client_ip(request: Request) -> str:
    """The visitor's IP, not the proxy's.

    Hosted behind a reverse proxy (HF Spaces, Render, Fly, Cloudflare),
    `request.client.host` is the PROXY for every visitor — so the per-IP limiter
    collapses into one global bucket and `RATE_LIMIT_PER_MIN` starts 429-ing
    real users as soon as there is any concurrent traffic at all.

    X-Forwarded-For is client-controlled and trivially spoofed, so this is a
    fair-use throttle, not a security control. The left-most entry is the
    originating client; the proxy appends its own hop on the right.
    """
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> str | None:
    now = time.time()
    if len(_hits) > 512:
        _sweep_hits(now)
    dq = _hits[ip]
    while dq and now - dq[0] > 60:
        dq.popleft()
    if len(dq) >= RATE_LIMIT_PER_MIN:
        return "Too many requests — please slow down a moment."
    today = time.strftime("%Y-%m-%d")
    if _day["date"] != today:
        _day.update(date=today, count=0)
    if _day["count"] >= DAILY_CAP:
        return "The assistant has hit its daily limit. Please try again tomorrow."
    dq.append(now)
    _day["count"] += 1
    return None


# ------------------------------ caches ------------------------------------- #
# Response cache: repeat/FAQ questions ("what's your experience?") are answered
# instantly with zero LLM spend. Keyed by normalized question.
_resp_cache: "OrderedDict[str, dict]" = OrderedDict()
_tts_cache: "OrderedDict[str, dict]" = OrderedDict()


def _norm(q: str) -> str:
    return " ".join(q.strip().lower().split())


def _cache_get(store: OrderedDict, key: str, ttl: int | None):
    item = store.get(key)
    if not item:
        return None
    if ttl is not None and time.time() - item["ts"] > ttl:
        store.pop(key, None)
        return None
    store.move_to_end(key)
    return item["val"]


def _cache_put(store: OrderedDict, key: str, val, maxlen: int):
    store[key] = {"val": val, "ts": time.time()}
    store.move_to_end(key)
    while len(store) > maxlen:
        store.popitem(last=False)


# ------------------------------ schema ------------------------------------- #
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "embed_backend": EMBED_BACKEND,
        "relevance_gate": MIN_RELEVANCE,
        "daily_used": _day["count"],
        "tts_enabled": TTS_ENABLED,
        "response_cache": len(_resp_cache),
        "tts_cache": len(_tts_cache),
    }


@app.get("/stats")
def stats(request: Request):
    """Aggregate observability: latency percentiles, rates, top questions, feedback."""
    if STATS_TOKEN and request.query_params.get("token") != STATS_TOKEN:
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return analytics.stats()


class FeedbackRequest(BaseModel):
    question: str = Field("", max_length=500)
    rating: str = Field(..., pattern="^(up|down)$")


@app.post("/feedback")
def feedback(req: FeedbackRequest, request: Request):
    analytics.record_feedback({"q": req.question, "rating": req.rating})
    return {"ok": True}


@app.get("/voices")
def voices():
    """List the account's available voices (id + name) to help pick a valid voice id."""
    if not ELEVEN_KEY:
        return JSONResponse(status_code=503, content={"error": "tts_unconfigured"})
    try:
        r = httpx.get(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": ELEVEN_KEY},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        print("[voices] error:", repr(e))
        return JSONResponse(status_code=502, content={"error": "voices_failed"})
    return {
        "configured": ELEVEN_VOICE,
        "voices": [
            {"voice_id": v.get("voice_id"), "name": v.get("name")}
            for v in data.get("voices", [])
        ],
    }


def _call_eleven(voice: str, text: str):
    """POST to ElevenLabs with-timestamps for a given voice. Returns Response or None."""
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps"
    try:
        return httpx.post(
            url,
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": ELEVEN_KEY, "content-type": "application/json"},
            json={
                "text": text,
                "model_id": ELEVEN_MODEL,
                "voice_settings": {"stability": 0.4, "similarity_boost": 0.75},
            },
            timeout=30,
        )
    except Exception as e:  # network / DNS / timeout
        print("[tts] request error:", repr(e))
        return None


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1)


@app.post("/tts")
def tts(req: TTSRequest, request: Request):
    """Proxy ElevenLabs 'with-timestamps' TTS: returns base64 audio + char timings.

    Keeps the API key server-side. Returns 503 when unconfigured so the frontend
    transparently falls back to browser SpeechSynthesis.
    """
    if not TTS_ENABLED:
        return JSONResponse(status_code=503, content={"error": "tts_unconfigured"})

    ip = _client_ip(request)
    if _rate_limited(ip):
        return JSONResponse(status_code=429, content={"error": "rate_limited"})

    text = req.text.strip()[:TTS_MAX_CHARS]
    if not text:
        return JSONResponse(status_code=400, content={"error": "empty"})

    # cache repeated lines (greeting, refusals, common answers) -> save cost + latency
    ckey = hashlib.sha1(f"{ELEVEN_VOICE}:{ELEVEN_MODEL}:{text}".encode()).hexdigest()
    cached = _cache_get(_tts_cache, ckey, None)
    if cached:
        return cached

    r = _call_eleven(ELEVEN_VOICE, text)
    if r is None:
        return JSONResponse(status_code=502, content={"error": "tts_unreachable"})

    # If the configured voice id is wrong, fall back to a valid default so it still speaks.
    if r.status_code == 404 and ELEVEN_VOICE != DEFAULT_VOICE:
        print(
            f"[tts] configured ELEVENLABS_VOICE_ID '{ELEVEN_VOICE}' not found — "
            f"falling back to default voice. Set a real voice id (see GET /voices)."
        )
        r = _call_eleven(DEFAULT_VOICE, text)
        if r is None:
            return JSONResponse(status_code=502, content={"error": "tts_unreachable"})

    if r.status_code != 200:
        print(f"[tts] ElevenLabs {r.status_code}: {r.text[:300]}")
        return JSONResponse(status_code=502, content={"error": "tts_failed", "status": r.status_code})
    data = r.json()

    payload = {
        "audio_base64": data.get("audio_base64"),
        "alignment": data.get("alignment"),
        "content_type": "audio/mpeg",
    }
    _cache_put(_tts_cache, ckey, payload, TTS_CACHE_MAX)
    return payload


@app.post("/chat")
def chat(req: ChatRequest, request: Request):
    ip = _client_ip(request)
    limit_msg = _rate_limited(ip)
    if limit_msg:
        return JSONResponse(status_code=429, content={"error": limit_msg})

    message = req.message.strip()[:MAX_MESSAGE_CHARS]
    key = _norm(message)

    def gen():
        t0 = time.time()
        ms = lambda: int((time.time() - t0) * 1000)  # noqa: E731

        # 1) Response cache — instant, zero-spend repeat answers.
        hit = _cache_get(_resp_cache, key, CACHE_TTL)
        if hit:
            yield _sse({"type": "meta", "provider": hit["provider"], "grounded": True, "cached": True})
            yield _sse({"type": "token", "text": hit["answer"]})
            yield _sse({"type": "sources", "sources": hit["sources"]})
            yield _sse({"type": "actions", "actions": hit["actions"]})
            yield _sse({"type": "done", "cached": True, "latency_ms": ms()})
            analytics.record_turn(
                {"q": message, "provider": hit["provider"], "grounded": True,
                 "cache_hit": True, "refused": False, "total_ms": ms(),
                 "first_token_ms": ms(), "retrieve_ms": 0}
            )
            return

        retr = retrieve(message, k=TOP_K)
        retrieve_ms = ms()

        # 2) Grounded-or-refuse: off-topic / no relevant context -> refuse, no LLM spend.
        if retr.top_score < MIN_RELEVANCE:
            yield _sse({"type": "meta", "provider": "guardrail", "grounded": False})
            yield _sse({"type": "token", "text": REFUSAL_TEXT})
            yield _sse({"type": "sources", "sources": []})
            yield _sse({"type": "actions", "actions": [{
                "type": "scroll_to_section", "section_id": "projects",
                "label": "Browse projects",
                "url": "https://ksubodh9.github.io/portfolio/#projects"}]})
            yield _sse({"type": "done", "latency_ms": ms(), "grounded": False})
            analytics.record_turn(
                {"q": message, "provider": "guardrail", "grounded": False,
                 "cache_hit": False, "refused": True, "total_ms": ms(),
                 "retrieve_ms": retrieve_ms, "top_score": retr.top_score}
            )
            return

        # 3) Generate (streamed, with provider fallback).
        system, user = build_messages(message, retr)
        provider_used = "unknown"
        answer = ""
        first_token_ms = None
        try:
            for delta in stream_answer(system, user):
                if delta.startswith("\x00PROVIDER:"):
                    provider_used = delta.split(":", 1)[1]
                    yield _sse({"type": "meta", "provider": provider_used, "grounded": True})
                    continue
                if first_token_ms is None:
                    first_token_ms = ms()
                answer += delta
                yield _sse({"type": "token", "text": delta})
        except Exception as e:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"Generation failed: {e}"})
            analytics.record_turn(
                {"q": message, "provider": provider_used, "grounded": True,
                 "cache_hit": False, "refused": False, "error": True,
                 "total_ms": ms(), "retrieve_ms": retrieve_ms}
            )
            return

        sources = cite_sources(retr)
        actions = derive_actions(retr, message)
        yield _sse({"type": "sources", "sources": sources})
        yield _sse({"type": "actions", "actions": actions})
        yield _sse({"type": "done", "provider": provider_used,
                    "top_score": retr.top_score, "latency_ms": ms(),
                    "first_token_ms": first_token_ms})

        # cache successful answers for instant, zero-spend repeats
        if answer.strip():
            _cache_put(_resp_cache, key,
                       {"answer": answer, "sources": sources, "actions": actions,
                        "provider": provider_used}, CACHE_MAX)
        analytics.record_turn(
            {"q": message, "provider": provider_used, "grounded": True,
             "cache_hit": False, "refused": False, "total_ms": ms(),
             "first_token_ms": first_token_ms, "retrieve_ms": retrieve_ms,
             "top_score": retr.top_score, "chars": len(answer)}
        )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
