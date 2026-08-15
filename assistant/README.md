# Portfolio AI Assistant — Backend

Grounded RAG assistant that answers questions about Subodh Kumar using only his real
portfolio content (resume, projects, experience, skills). This is the backend for the
AI Avatar Assistant described in [`../docs/ai-avatar-assistant-plan.md`](../docs/ai-avatar-assistant-plan.md).

## Phase 0 — Knowledge layer (this folder, current state)

Single source-of-truth knowledge → chunk → embed (BGE) → Chroma vector index →
hybrid retriever (always-on core facts card + semantic top-k), with a labelled
retrieval eval gate.

```
assistant/
├── knowledge/
│   ├── profile.json      # structured "core facts" card (always in prompt)
│   ├── manifest.json     # doc -> {source, section_id, url} for citations/deep-links
│   ├── about.md  experience.md  skills.md  projects.md   # source-of-truth content
├── common.py             # config, embedder (BGE | offline hashing), chunking
├── ingest.py             # build the Chroma index from knowledge/
├── retriever.py          # retrieve(query) -> core card + cited top-k hits
├── eval/
│   ├── retrieval_questions.json   # 22 labelled questions
│   └── test_retrieval.py          # section/keyword hit-rate + pass/fail gate
├── requirements.txt
└── .gitignore            # data/ (index) is generated, not committed
```

## Setup & run

```bash
cd assistant
python -m venv .venv && source .venv/bin/activate    # optional
pip install -r requirements.txt

python ingest.py                    # build the vector index (downloads BGE once, ~130MB)
python retriever.py "Tell me about Subodh's recent GenAI project."   # try a query
python eval/test_retrieval.py       # run the retrieval quality gate
```

## Embedding backends

`common.py` supports two backends via the `EMBED_BACKEND` env var:

- **`bge`** (default, production) — FastEmbed `BAAI/bge-small-en-v1.5`, semantic. Same
  BGE family used in DocIntel / LaraOpsCopilot. Needs a one-time model download.
- **`hashing`** (offline fallback) — scikit-learn `HashingVectorizer`, lexical only,
  no download. Used for CI / air-gapped smoke tests where Hugging Face is unreachable.

The eval script adapts: **`bge` runs the real 90% semantic quality gate**; `hashing`
runs a lower-floor lexical smoke test (it can't match paraphrased queries by design).

```bash
python eval/test_retrieval.py                 # semantic gate (BGE)
EMBED_BACKEND=hashing python ingest.py && EMBED_BACKEND=hashing python eval/test_retrieval.py   # offline smoke
```

If the repo lives on a network/mounted filesystem where SQLite locking fails, point the
index at local disk: `export ASSISTANT_DATA_DIR=/tmp/assistant_data`.

## Updating the knowledge base

Edit the files in `knowledge/` (or regenerate `projects.md` from `../src/data/projects.json`)
and re-run `python ingest.py`. Every chunk keeps `source`, `section_id`, and `url`
metadata so Phase 1 answers can cite sources and deep-link to the right portfolio section.

## Phase 1 — Grounded chat API (built)

FastAPI `/chat` SSE endpoint over the retriever:

```
prompt.py    system prompt (strict grounding) + refusal text + actions/citations
llm.py       provider abstraction: Gemini (primary) -> Groq (fallback) -> offline echo
server.py    /chat (SSE) + /health, CORS lock, rate limit + daily cap, relevance gate
eval/test_pipeline.py   end-to-end test (SSE framing, grounding, refusal, actions)
```

Per turn: **relevance gate → retrieve → grounded prompt → stream LLM (with fallback) →
emit tokens + sources + navigation actions** over Server-Sent Events. Off-topic or
low-relevance questions are refused *before* any LLM call (no hallucination, no spend).
Cited sections become `scroll_to_section` deep-link actions; hiring/résumé questions add
an `open_resume` action — the deterministic "tool" layer (LLM-native function calling is
a V2 upgrade).

### Run the API

```bash
cp .env.example .env          # add GEMINI_API_KEY (free: aistudio.google.com/apikey)
python ingest.py              # build the index (BGE)
uvicorn server:app --port 8000
# then:
curl -N -X POST localhost:8000/chat -H 'content-type: application/json' \
     -d '{"message":"Tell me about Subodh'\''s recent GenAI project."}'
```

With no API key it still runs — the offline provider serves grounded answers from
context, so the pipeline never hard-fails.

### Test (no key required)

```bash
# offline, air-gapped smoke of the whole pipeline:
EMBED_BACKEND=hashing python ingest.py
EMBED_BACKEND=hashing LLM_PROVIDER_ORDER=offline python eval/test_pipeline.py
EMBED_BACKEND=hashing LLM_PROVIDER_ORDER=offline python eval/test_retrieval.py
```

## Docker

The backend is containerised. The image **bakes the BGE model + vector index at build
time**, so cold starts are instant (no first-request download) — useful on free-tier
hosts like Render/Fly.

```bash
cd assistant
cp .env.example .env                 # add GEMINI_API_KEY (never committed — see .dockerignore)

docker compose up --build            # -> http://localhost:8000
# or plain docker:
docker build -t portfolio-assistant .
docker run --rm -p 8000:8000 --env-file .env portfolio-assistant
```

- `Dockerfile` — python:3.11-slim, installs deps, runs `ingest.py` at build, runs as a
  non-root user, and honors `$PORT` (injected by Render/Fly; defaults to 8000).
- `docker-compose.yml` — local run with `.env`, port mapping, and a `/health` healthcheck.
- Air-gapped / offline image build (no model download): `--build-arg EMBED_BACKEND=hashing`.

Deploy: push this image to Render/Fly/any container host, set the env vars from
`.env.example`, then point the frontend widget's `data-api-base` at the deployed URL.

## Voice-out (TTS) — `POST /tts`

Higher-quality speech + precise, word-timed lip-sync via ElevenLabs, proxied so the
API key stays server-side.

- Request: `{ "text": "<one sentence>" }`
- Response: `{ audio_base64, alignment: { characters, character_start_times_seconds,
  character_end_times_seconds }, content_type }`
- `503 tts_unconfigured` when `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` are unset —
  the **frontend transparently falls back to browser SpeechSynthesis**, so voice still
  works with no key (just lower quality, coarser lip-sync).

The frontend voice controller (`assets/js/assistant-voice.js`) picks the engine
automatically: ElevenLabs if `/tts` is available, else the browser. It streams
sentence-by-sentence (speech starts before the full answer is done) and drives the
avatar mouth from the ElevenLabs character timings (`onLevel` → `avatar.setMouth`).

TTS is the main paid component — it's rate-limited and `TTS_MAX_CHARS`-capped; keep the
`DAILY_CAP` / spend cap in mind. Uses `eleven_flash_v2_5` (~75ms first byte) by default.

## Latency & observability

**Caching (latency + cost).**
- **Response cache** — repeat/FAQ questions ("what's your experience?") are answered
  instantly from memory with **zero LLM spend** (keyed by normalized question, TTL
  `CACHE_TTL`). The `done`/`meta` events carry `"cached": true` on a hit.
- **TTS cache** — repeated lines (greeting, refusals, common answers) skip a paid
  ElevenLabs call.
- **Query-embedding cache** — repeat questions skip re-embedding (`lru_cache` in the retriever).

**Cold-start warmup.** A startup hook pre-loads the embedder + Chroma collection + core
card, so the first real request is fast (measured: first call `~3800ms → ~20ms` here).

**Per-stage instrumentation.** Every turn records `retrieve_ms`, `first_token_ms`,
`total_ms`, provider, grounded/refused, and cache status into an in-memory ring buffer
(+ best-effort `data/analytics.jsonl`).

**`GET /stats`** — aggregates for observability (optionally gated by `?token=` if
`STATS_TOKEN` is set):

```json
{ "turns": N, "refusal_rate": .., "grounded_rate": .., "cache_hit_rate": ..,
  "latency_ms": { "total": {"p50":..,"p90":..,"p95":..}, "first_token": {..}, "retrieve": {..} },
  "providers": {..}, "top_questions": [..], "feedback": {"up":..,"down":..} }
```

**`POST /feedback`** — `{ "question": "...", "rating": "up"|"down" }`. The frontend shows
👍/👎 under each answer and posts here; tallies show up in `/stats`.

## SSE event protocol

`/chat` streams `data: {json}` lines. Event `type`s, in order:

| type | payload | meaning |
|---|---|---|
| `meta` | `{provider, grounded}` | which provider served the turn; grounded flag |
| `token` | `{text}` | one streamed answer delta (append to the bubble) |
| `sources` | `{sources: [{source, heading, url, score}]}` | citations to display |
| `actions` | `{actions: [{type, label, url, section_id?}]}` | deep-link / résumé buttons |
| `done` | `{provider, top_score, latency_ms}` | end of turn |
| `error` | `{message}` | generation failed after all fallbacks |

## Next: Phase 2 (voice-out) & the frontend widget

Phase 1 is backend-complete. Next per the roadmap: a small frontend chat widget that
consumes this SSE protocol and renders the deep-link actions, then Phase 3 (streaming
TTS so the answer is spoken) ahead of the 3D avatar. See
[`../docs/ai-avatar-assistant-plan.md`](../docs/ai-avatar-assistant-plan.md).
```
