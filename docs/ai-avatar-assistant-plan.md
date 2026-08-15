# AI Avatar Assistant — Research, Analysis & Build Plan

**For:** Subodh Kumar's portfolio (`ksubodh9.github.io/portfolio`)
**Author of analysis:** research done Aug 2026, verified against current provider docs/benchmarks
**Status:** decision document — no code yet

---

## 0. TL;DR (read this first)

**Build it — but build it as an AI engineering project, not an avatar demo.**

The valuable, defensible, interview-worthy part is the *grounded RAG voice assistant backend*. The avatar is the least impressive part technically and the most time-consuming — so it should be the *last* thing you add, and it should be lightweight (client-side, free), not a paid avatar API.

Your situation is unusually favourable for one reason: **your flagship project (DocIntel) is already a production RAG platform** with multi-provider LLM fallback, and your site literally has a "How my AI systems actually work" section describing that pipeline. An assistant that answers questions *about you* using *that same pipeline* closes the loop perfectly — it's proof-by-demonstration, not a gimmick bolted on.

- **MVP (must-have):** text chat, grounded RAG over your resume/projects/case-studies, streaming answers, hallucination guardrails + citations that deep-link to portfolio sections. ~1 week.
- **V2 (high value):** voice in (browser STT) + voice out (streaming TTS), latency tuning, eval harness, observability. ~1–1.5 weeks.
- **Advanced (differentiator):** 3D talking-head avatar with audio-driven lip-sync, barge-in, conversation memory, analytics dashboard. ~1.5–2 weeks, most of it visual/3D learning curve.

**Estimated running cost:** effectively **$0–5/month** at portfolio traffic if you use browser STT + a cheap LLM + a free/cheap TTS tier. The main variable cost is TTS; everything else fits free tiers.

**Biggest risk:** scope creep on the avatar and lip-sync eating weeks for the least differentiating 20%. Mitigate by shipping the text MVP publicly first.

---

## 1. Is the concept any good? (honest evaluation)

### Is it technically feasible today?
Yes, entirely, in the browser, with mature tooling. Every sub-component (RAG, streaming LLM, browser STT, streaming TTS with word timestamps, WebGL avatar, audio-driven lip-sync) has production-grade options in 2026. None of it is research-grade or risky. The hard part is *integration and latency*, not capability.

### Is it valuable or a gimmick?
It's **both**, and which one it becomes depends entirely on how you build it.

It's a **gimmick** if: the avatar is the headline, it answers from a hard-coded script or an ungrounded LLM, it's slow (5s+ to first word), or it hallucinates a job you never had. Recruiters have seen talking-head demos; a laggy one that makes things up actively hurts you.

It's **genuinely valuable** if: it demonstrably retrieves from your real materials, cites them, refuses to invent facts, streams fast, and you can whiteboard the architecture. For an **AI/GenAI Engineer** candidate, a working RAG + streaming + eval + observability system that lives on your own domain is a stronger signal than another GitHub repo, because the interviewer can *use it* and then you can *explain it*.

The honest tension: recruiters spend ~30–90s on a portfolio. A voice avatar has novelty pull (good for attention) but adds friction (mic permissions, they may be in an open office). So: **text-first, voice optional, avatar as delight** — never force the voice/avatar path.

### Which parts show real AI engineering skill vs. frontend polish?

| Part | What it demonstrates | Weight |
|---|---|---|
| RAG pipeline (chunking, embeddings, retrieval, grounding) | Core GenAI eng | ★★★★★ |
| Hallucination control / grounded-or-refuse | Production LLM judgment | ★★★★★ |
| Retrieval + answer **evaluation** harness | Senior signal, most people skip it | ★★★★★ |
| Multi-provider LLM abstraction + fallback | Reliability engineering | ★★★★ |
| Streaming (SSE/WebSocket), latency budgeting | Real-time systems | ★★★★ |
| Voice pipeline orchestration (STT→LLM→TTS) | Multimodal systems | ★★★★ |
| Observability (traces, latency, cost, eval scores) | Production maturity | ★★★★ |
| Conversation memory / state | Applied LLM | ★★★ |
| TTS integration + word-timestamp alignment | Integration skill | ★★★ |
| Avatar rendering (three.js / Ready Player Me) | **Mostly frontend/visual** | ★★ |
| Lip-sync (audio-driven visemes) | Clever, but a library does it | ★★ |
| Idle animation, blinking, expressions | Pure frontend polish | ★ |

**Takeaway:** ~70% of the *impressive* engineering is invisible backend work. The avatar is ~15% of the value and ~40% of the effort. Budget accordingly.

### What makes it impressive to an AI/GenAI recruiter specifically
Not the avatar. It's the ability to answer, credibly and with numbers: *how you kept it grounded, how you measured retrieval quality, how you cut latency, what happens when the LLM fails, and how you'd scale it.* Design the project so those answers are real, not aspirational (Section 6).

---

## 2. Technology landscape & build-vs-buy

> Prices/latencies below are current provider figures as of Aug 2026; treat them as directional and re-check before committing, since this market moves monthly. Sources listed at the end.

### 2.1 AI / reasoning layer

**LLM.** Your knowledge base is tiny (resume + ~8 projects + 6 case studies ≈ 15k–40k tokens total). You do **not** need a frontier model. A small, fast, cheap model is correct here:
- **Gemini 2.x Flash**, **GPT-5 mini/nano**, **Claude Haiku**, or **Llama 3.3-70B via Groq/Cerebras** (very low latency). Cost is ~$0.05–$0.50 per 1M tokens for the cheap tier — pennies per thousand conversations.
- You already run a **multi-provider abstraction with automatic fallback** in DocIntel. Reuse that pattern — it's a great reliability story ("if Gemini 429s, I fail over to Groq").
- **Recommendation:** primary = Gemini Flash *or* Groq-hosted Llama (speed); fallback = a second provider. Keep it swappable behind one interface.

**RAG.** The interesting nuance: at this KB size you *could* skip retrieval and stuff everything into the context window. Long-context models make "RAG is dead" a recurring claim. But for a portfolio the current consensus still favours retrieval, because it gives you **citations, updateability, lower per-call cost, and avoids "lost in the middle."** More importantly for *you*: implementing RAG is the point — it's the skill you're advertising.
- **Recommended hybrid:** a small always-in-prompt "core facts card" (name, roles, headline skills, contact) + retrieval over chunked projects/case-studies for depth. This guarantees basic questions never fail retrieval while still exercising a real vector pipeline.
- **Embeddings:** BGE-M3 / Qwen3-embedding / `text-embedding-3-small` / Nomic. You already use **FastEmbed (BGE on ONNX)** — reuse it (great "runs locally, ~400MB footprint" story you already tell on the site).
- **Vector store:** the KB is small enough that FAISS/Chroma in-memory or **pgvector on Supabase** (which you already use) is plenty. No Pinecone needed.

**Agent / orchestration.** Full agent frameworks (LangGraph, CrewAI, multi-tool ReAct) are **overkill and a red flag** here — a recruiter will read them as complexity for its own sake. What *is* justified: a small amount of **tool/function calling** so the assistant can do useful actions — e.g. `open_section(id)` to scroll the page to the relevant project, `get_resume_link(role)`, `list_projects(tag)`. That demonstrates agentic tool use *proportionate to the problem*, which is the mature choice.

**Knowledge structuring.** Build a single source-of-truth `knowledge/` set: structured `profile.json` (roles, skills, contact), your existing `projects.json`, resume text, and the case-study HTML converted to clean markdown. A tiny ingestion script chunks + embeds them. Keep provenance metadata (`source`, `section_id`, `url`) on every chunk so citations can deep-link.

### 2.2 Voice

**STT (speech-to-text):**
- **MVP:** browser **Web Speech API** — free, zero backend, decent for quiet environments. Ships in Chrome/Edge. Weakness: inconsistent across browsers, no control.
- **V2:** **Deepgram Nova** (~<300ms streaming) or **AssemblyAI Universal-3 streaming** (~150–310ms P50 in benchmarks). Both stream over WebSocket; pay-per-minute but cheap at portfolio volume.
- **Advanced:** collapse STT+LLM+TTS into **OpenAI Realtime API** (speech-to-speech, single model, lowest architectural latency) — but it's pricier (~$0.05–0.24/min of audio) and gives you *less* to show off (the pipeline is hidden inside one API).

**TTS (text-to-speech):**
- **ElevenLabs Flash v2.5** — ~75ms first-chunk latency, streaming, and crucially exposes **word/character-level timestamps** you can drive lip-sync from. Best quality/latency, but the main paid component.
- **Azure Neural TTS** — streams **viseme events directly** (mouth-shape IDs with timing), which makes accurate lip-sync trivial. Cheaper, slightly less natural voices. Strong option specifically *because* of visemes.
- **OpenAI TTS / Google Cloud TTS** — fine, fewer alignment features.
- **MVP fallback:** browser **SpeechSynthesis** — free, robotic, but proves the loop end-to-end at $0.

**Real-time / latency:** stream everything. Non-streaming TTS alone adds 400–800ms. Target "first audio out" not "full answer ready" (Section 3.7).

### 2.3 Avatar (2D vs 3D)

| Option | Effort | Cost | Eng story | Verdict |
|---|---|---|---|---|
| **2D sprite / image with mouth shapes** (swap viseme PNGs) | Low | Free | Low | Great MVP-of-avatar; surprisingly convincing |
| **3D Ready Player Me + three.js + TalkingHead.js** | Med-High | Free | Medium | **Recommended** for the "wow" build |
| **Live2D** (VTuber-style 2D rig) | Med | Free/cheap | Low-Med | Nice middle ground, more art-dependent |
| **Avatar-as-a-service** (HeyGen LiveAvatar, Tavus, Simli, Anam, D-ID) | Low integration | **$0.10–$3.00 / active minute** | Low (it's someone else's model) | **Avoid** for a public portfolio — per-visitor cost + you didn't build the hard part |

**Recommendation:** client-side **Ready Player Me** avatar (free GLB you generate from a photo/config) rendered with **three.js**, driven by **TalkingHead.js** (open-source, purpose-built for RPM avatars, handles visemes, blinking, idle, head movement). It's free, runs entirely in the visitor's browser (zero per-visitor cost), and is the standard stack for exactly this. Start with a 2D fallback so the feature works before you learn three.js.

Avatar-as-a-service is the wrong call here: it costs money on every recruiter visit, and it *removes* the engineering you'd want to claim credit for.

### 2.4 Lip-sync

Two families:
1. **Audio-driven (analyse the audio waveform → visemes in real time).** Libraries: **wawa-lipsync** (free, browser-native, Web Audio API, works with *any* audio source), **lipsync-engine** (AudioWorklet). Pro: works even with the free browser TTS, no timestamp dependency. Con: approximate (energy/formant heuristics), not phoneme-perfect.
2. **Phoneme/viseme-driven (TTS tells you the mouth shapes).** Use **Azure visemes** or **ElevenLabs word timestamps** to schedule mouth shapes precisely. Pro: accurate, in sync with actual phonemes. Con: couples you to a specific TTS.

**How accurate can browser lip-sync realistically get?** "Good enough to read as talking," not film-grade. Audio-driven gives believable open/close + broad shapes; viseme-driven gets you crisp consonant/vowel distinction. Neither achieves photorealistic muscle simulation — and at avatar size on a portfolio, nobody will notice the difference. **Recommendation:** start with **wawa-lipsync** (decouples lip-sync from TTS, ship fast), and if you want the polish story, add **Azure viseme** driving as an upgrade path you can talk about.

### 2.5 Communication / streaming

| Transport | Use it for | Why |
|---|---|---|
| **SSE (Server-Sent Events)** | Streaming LLM tokens (text) | Simplest, HTTP, one-way, perfect for token stream |
| **WebSocket** | Voice session (STT partials + audio chunks both ways) | Bidirectional, low overhead |
| **WebRTC** | Only if using OpenAI Realtime or an avatar-as-a-service | Handles audio transport + echo cancellation; overkill otherwise |
| **fetch + ReadableStream** | Streaming TTS audio chunks to the player | Native, works with chunked audio |

**Recommendation:** SSE for the MVP text stream; add a WebSocket for the voice session in V2. Skip WebRTC unless/until you adopt OpenAI Realtime.

### 2.6 Build-vs-buy summary (the table you asked for)

| Component | Build ourselves | Use API/service | **Best for this project** |
|---|---|---|---|
| **LLM** | Self-host OSS (don't) | Gemini Flash / Groq-Llama / GPT-mini / Haiku | **Buy** — cheap API, multi-provider fallback (reuse DocIntel pattern) |
| **RAG** | **Build** (chunk, embed, retrieve, ground) | Managed RAG (Vectara etc.) | **Build** — this *is* the skill you're showcasing |
| **STT** | Whisper self-host (heavy) | Web Speech (free) → Deepgram/AssemblyAI | **Buy/Browser** — Web Speech MVP, Deepgram V2 |
| **TTS** | Coqui/Piper self-host | ElevenLabs Flash / Azure / browser | **Buy** — ElevenLabs Flash (or Azure for visemes); browser fallback |
| **Avatar** | **Build** (three.js + RPM + TalkingHead) | HeyGen/Tavus/Simli ($/min) | **Build** — free, client-side, keeps the eng credit |
| **Lip-sync** | Integrate lib (wawa-lipsync) | Baked into avatar services | **Build/Integrate** — wawa-lipsync, optional Azure visemes |
| **Streaming** | **Build** (SSE + WebSocket) | — | **Build** — trivial, and good to demonstrate |
| **Orchestration** | **Build** (thin: RAG + tool calls) | LangGraph/agents | **Build thin** — avoid heavy frameworks |
| **Observability** | **Build** or Langfuse (OSS, self-host/free tier) | Datadog etc. | **Build/Langfuse** — traces, latency, cost, eval |

---

## 3. Proposed architecture

Your linear sketch is basically right but under-specifies streaming, grounding, memory, and fallbacks. Improved version:

```
┌─────────────────────────── BROWSER (static site, GitHub Pages) ───────────────────────────┐
│  Portfolio UI (existing vanilla site)                                                      │
│    └─ Assistant widget                                                                     │
│         ├─ Input:  text box  |  mic → STT (Web Speech / Deepgram WS)                        │
│         ├─ Transport: SSE (text stream)  +  WebSocket (voice session)                       │
│         ├─ Audio player (streamed TTS chunks)                                               │
│         └─ Avatar (three.js + Ready Player Me + TalkingHead.js)                              │
│               └─ lip-sync: wawa-lipsync (audio-driven) / Azure visemes                       │
│               └─ idle: blink, breathe, head sway, expressions                               │
└───────────────▲───────────────────────────────────────────────────┬───────────────────────┘
                │ SSE tokens / WS audio                               │ user text / audio
                │                                                     ▼
┌───────────────┴──────────────────── BACKEND (FastAPI, hosted service) ──────────────────────┐
│  API gateway  ─  rate limit  ─  CORS(allow only your domain)  ─  abuse/PII guard             │
│        │                                                                                     │
│        ▼                                                                                     │
│  Orchestrator (per turn):                                                                    │
│    1. Moderation / off-topic + prompt-injection check                                        │
│    2. Retrieve:  embed query → vector search (pgvector/Chroma) → top-k chunks + core card    │
│    3. Assemble grounded prompt (system rules + citations + short convo memory)               │
│    4. LLM call (primary → fallback on error/timeout)  ── streams tokens ──► SSE              │
│    5. Tool calls if needed:  open_section(id) / get_resume(role) / list_projects(tag)        │
│    6. Grounding check: if retrieval weak → "I don't have that about Subodh" (no hallucinate)  │
│    7. Stream sentences → TTS (ElevenLabs/Azure) → audio + word timestamps ──► client         │
│        │                                                                                     │
│  Conversation memory (session): last N turns, summarised                                     │
│  Cache: embedding cache + response cache for FAQ ("what's your experience?")                 │
│  Observability: Langfuse traces (retrieval hits, tokens, latency per stage, cost, eval)       │
└───────────────▲──────────────────────────────────────────────────────────────────────────────┘
                │ (offline, on content change)
        ┌───────┴────────┐
        │ Ingestion job  │  profile.json + projects.json + resume + case-studies(md)
        │ chunk → embed  │  → vector store (with source/section_id/url metadata)
        └────────────────┘
```

### 3.1 Frontend
Keep the existing zero-dependency static site. Add the assistant as an isolated widget (its own JS module + CSS, lazy-loaded so it never slows the main page). The 3D avatar and three.js should **only** load when the user opens the assistant (code-split / dynamic import) — critical for your Lighthouse score and mobile. Provide a 2D fallback and a "text-only" mode.

### 3.2 Backend
**FastAPI** (Python) — matches your strongest skills and your DocIntel stack. It's a *separate* service from the static site (GitHub Pages can't run backends). Endpoints: `POST /chat` (SSE stream), `WS /voice`, `GET /health`. Stateless per request except a short-lived session store (in-memory or Redis) for conversation memory.

### 3.3 AI orchestration
Thin, hand-written orchestrator (no heavy agent framework): moderate → retrieve → ground → generate (with fallback) → optional tool call → stream → TTS. Function calling only for the 2–3 genuinely useful tools (scroll to section, fetch resume link, filter projects).

### 3.4 Knowledge / RAG
Offline ingestion script builds the index from your source-of-truth files. Hybrid retrieval (core facts card always present + vector top-k for depth). Every chunk carries `source`, `section_id`, `url` so answers can cite and the UI can deep-link/scroll. Re-run ingestion whenever you update `projects.json` (wire it into your existing build step or a GitHub Action).

### 3.5 Voice pipeline
MVP: browser Web Speech (STT) + browser SpeechSynthesis or ElevenLabs (TTS). V2: WebSocket voice session, Deepgram streaming STT with partial results, ElevenLabs Flash streaming TTS. Advanced: optional OpenAI Realtime speech-to-speech as an alternate "low-latency mode" (and a great comparison point in interviews).

### 3.6 Avatar pipeline
three.js scene + RPM GLB, loaded lazily. TalkingHead.js (or a thin custom driver) maps incoming audio/visemes to morph targets; adds blink/idle/head-sway. Audio and mouth data arrive together so lip-sync stays in sync with playback. Everything runs client-side → **zero per-visitor server cost**.

### 3.7 Streaming & latency (where it breaks, how to fix)
The enemy is **time-to-first-audio**, not total time. Naive serial pipeline:

```
STT final (300ms) → retrieve+embed (100ms) → LLM full answer (1500ms) → TTS full (500ms) → play
   ≈ 2.4s+ before the user hears anything  ✗ feels broken
```

Optimised pipeline (target **<1.2s to first word**):
- **Stream the LLM**, and as soon as the **first sentence** is complete, send it to TTS while the LLM keeps generating the rest ("sentence-level pipelining").
- **Stream TTS** (Flash ~75ms first chunk) and start avatar playback on the first audio chunk.
- Use **partial STT results** to start embedding/retrieval before the user finishes speaking (speculative retrieval).
- **Cache** embeddings and common answers ("tell me about your experience" is asked constantly).
- Keep the LLM prompt short (small core card + top-k, not the whole KB) — fewer input tokens = faster first token.
- Co-locate backend region with your TTS/LLM provider region to shave RTT.
- Optional nuclear option: OpenAI Realtime (speech-to-speech) removes the STT→LLM→TTS hops entirely.

### 3.8 State / memory
Session-scoped short memory: keep last N turns, summarise older ones into a running summary to bound token growth. No cross-session persistence needed (and better for privacy). Store server-side keyed by an ephemeral session id.

### 3.9 Caching
Three layers: (1) embedding cache for repeated queries, (2) full-response cache for FAQ-style questions, (3) TTS audio cache for canned lines (greeting, "I can't answer that"). Big latency + cost win for near-zero effort.

### 3.10 Security
CORS locked to your domain; **rate limiting** per IP/session (this is public and LLM calls cost money — someone *will* try to run up your bill or jailbreak it); **prompt-injection / off-topic guardrail**; strip PII from logs; never expose provider API keys to the client (all provider calls server-side); a hard monthly spend cap / kill switch. Treat the mic transcript as untrusted input.

### 3.11 Observability
**Langfuse** (open-source, generous free tier) or a lightweight custom trace: per turn log retrieval hits + scores, chosen provider, tokens, **latency per stage** (STT/retrieve/LLM-first-token/TTS-first-chunk/total), cost, and eval score. This is the data you'll quote in interviews and the dashboard that makes the project look production-grade.

### 3.12 Deployment
- **Frontend:** stays on GitHub Pages (unchanged).
- **Backend:** a small always-on host — **Render / Railway / Fly.io** free-or-cheap tier, or a serverless container. Avoid pure lambda for the WebSocket voice path (needs a persistent connection); a small always-on instance is simpler. Dockerise (you already use Docker). CI via GitHub Actions: run evals on deploy, fail the build if retrieval/grounding scores drop.

---

## 4. What to actually build (scope discipline)

### MVP — "smallest thing that's already impressive" (must-have)
Text-only, no avatar, no voice.
- Grounded RAG over your real materials, streaming answers (SSE).
- Citations that deep-link/scroll to the relevant portfolio section.
- **Grounded-or-refuse** guardrail (no hallucinated jobs/skills).
- 2–3 function-call tools (scroll to project, hand over resume link).
- Basic rate limiting + spend cap.
- A tiny eval set (20–30 Q&A) you can run.

This alone is a legitimate, defensible GenAI project and safe to put in front of recruiters.

### V2 — voice + rigor (high value / nice-to-have)
- Voice **out**: streaming TTS (ElevenLabs Flash), audio player.
- Voice **in**: browser STT (Web Speech), push-to-talk.
- Latency optimisation (sentence pipelining, caching).
- Observability dashboard (Langfuse) + expanded eval harness with retrieval metrics.
- Multi-provider LLM fallback wired in.

### Advanced — the differentiator (nice-to-have / genuinely exceptional)
- 3D Ready Player Me avatar + three.js + audio-driven lip-sync + idle/blink/expressions.
- Streaming voice session over WebSocket, barge-in (interrupt while speaking).
- Optional OpenAI Realtime "low-latency mode" toggle for comparison.
- Analytics: what recruiters actually ask, funnel, latency percentiles.
- Automated eval in CI (LLM-as-judge for groundedness + retrieval hit-rate).

### Explicitly *unnecessary* complexity (cut these)
- Heavy agent frameworks (LangGraph/CrewAI) for an 8-project KB.
- Fine-tuning or training your own model.
- Photorealistic / paid avatar-as-a-service ($/visitor).
- A dedicated vector DB service (Pinecone) — pgvector/Chroma is plenty.
- Cross-session user accounts / long-term memory.
- Multi-language support (unless targeting non-English recruiters).
- WebRTC (unless you adopt Realtime/avatar-service).

---

## 5. Development roadmap (phased, with effort estimates)

Effort assumes **one dev who is strong in Python/backend/APIs/GenAI but new to 3D/avatar/frontend-heavy work**. Ranges are focused working days.

### Phase 0 — Knowledge layer (foundation)
- **Objective:** single source-of-truth + working retrieval.
- **Tasks:** assemble `profile.json`; convert resume + case-studies to clean markdown; chunking strategy; embed (reuse FastEmbed/BGE); build pgvector/Chroma index with metadata; a `retrieve(query)` you can test.
- **Tech:** FastEmbed/BGE, pgvector or Chroma, Python.
- **Complexity:** Low-Med. **Effort: 1–2 days.**
- **Depends on:** nothing. **Gate before next:** retrieval returns the right chunk for 20 hand-written questions.

### Phase 1 — Conversational assistant (MVP core)
- **Objective:** grounded, streaming text chat.
- **Tasks:** FastAPI `/chat` SSE endpoint; grounded prompt template; grounded-or-refuse rule; multi-provider client w/ fallback; 2–3 tool calls; frontend widget (text) with streaming render + citation deep-links; rate limit + spend cap.
- **Tech:** FastAPI, SSE, Gemini/Groq/GPT-mini, vanilla JS widget.
- **Complexity:** Med. **Effort: 3–4 days.**
- **Depends on:** Phase 0. **Gate:** answers correctly with citations, refuses unknowns, deployed publicly.

### Phase 2 — Evaluation & observability (do this before voice)
- **Objective:** prove quality with numbers.
- **Tasks:** 30–50 Q&A eval set; retrieval hit-rate metric; LLM-as-judge groundedness/faithfulness; Langfuse tracing (latency per stage, cost, tokens); CI eval gate.
- **Tech:** Langfuse, a small eval script, GitHub Actions.
- **Complexity:** Med. **Effort: 2 days.**
- **Depends on:** Phase 1. **Gate:** you can quote retrieval hit-rate + groundedness scores.

### Phase 3 — Voice output (TTS)
- **Objective:** the assistant speaks, low latency.
- **Tasks:** ElevenLabs Flash streaming integration; sentence-level pipelining (TTS starts on first sentence); browser audio player; TTS cache for canned lines.
- **Tech:** ElevenLabs Flash v2.5 (or Azure), fetch streaming.
- **Complexity:** Med. **Effort: 2 days.**
- **Depends on:** Phase 1.

### Phase 4 — Voice input (STT)
- **Objective:** talk to it.
- **Tasks:** Web Speech API push-to-talk (MVP); speculative retrieval on partials; later Deepgram WebSocket streaming.
- **Tech:** Web Speech API → Deepgram/AssemblyAI.
- **Complexity:** Low-Med (Web Speech), Med (Deepgram). **Effort: 1–2 days.**
- **Depends on:** Phase 3 for the full loop.

### Phase 5 — Avatar (visual)
- **Objective:** a face that feels alive. **This is the learning-curve phase for you.**
- **Tasks:** generate RPM avatar; three.js scene; load GLB; idle/blink/breathe/head-sway; lazy-load so main site stays fast; 2D fallback first.
- **Tech:** three.js, Ready Player Me, TalkingHead.js.
- **Complexity:** **High for a non-3D dev** (new mental model: scenes, morph targets, render loop). **Effort: 3–5 days** (budget for a learning ramp; the 2D fallback is <1 day and de-risks it).
- **Depends on:** nothing technically, but do it after voice so there's something to lip-sync.

### Phase 6 — Lip-sync
- **Objective:** mouth matches speech.
- **Tasks:** wire **wawa-lipsync** to the TTS audio stream → morph targets; tune smoothing; optionally add Azure viseme driving for accuracy.
- **Tech:** wawa-lipsync (+ optional Azure visemes).
- **Complexity:** Med. **Effort: 1.5–2.5 days.**
- **Depends on:** Phase 3 (TTS) + Phase 5 (avatar).

### Phase 7 — Streaming / latency optimisation
- **Objective:** hit <1.2s to first word, smooth barge-in.
- **Tasks:** WebSocket voice session; barge-in (interrupt on new speech); caching layers; region co-location; measure p50/p90.
- **Complexity:** Med-High. **Effort: 2–3 days.**
- **Depends on:** Phases 3–4.

### Phase 8 — Production deployment & hardening
- **Objective:** safe, cheap, resilient in the wild.
- **Tasks:** Dockerise; deploy backend (Render/Railway/Fly); CORS + rate limits + spend cap + kill switch; prompt-injection guard; health checks; alerts.
- **Complexity:** Med. **Effort: 1–2 days.**

### Phase 9 — Analytics & evaluation loop
- **Objective:** learn from real recruiter use, keep improving.
- **Tasks:** question analytics, latency percentiles dashboard, periodic eval runs, feedback thumbs.
- **Complexity:** Low-Med. **Effort: 1–2 days.**

**Rough totals:** MVP (P0–P1) ≈ **1 week**. + Eval/voice (P2–P4) ≈ **+1 to 1.5 weeks**. + Avatar/lip-sync/latency/prod (P5–P8) ≈ **+1.5 to 2 weeks**. Full advanced build ≈ **4–5 focused weeks**, front-loaded value.

---

## 6. Making it career-relevant (interview defensibility)

Design each piece so it *produces evidence* you can cite. Target answers you should be able to give cold:

- **"Why this architecture?"** — Decoupled static frontend (fast, free hosting) + stateless FastAPI backend + client-side avatar (zero per-visitor cost). Streaming-first because time-to-first-word governs perceived latency. Thin orchestration over a small KB because heavy agent frameworks would be unjustified complexity.
- **"Why this model?"** — Small KB + latency-sensitive UX → a fast cheap model (Flash/Groq-Llama/mini) beats a frontier model; multi-provider fallback for reliability. Show the cost math.
- **"How does the RAG pipeline work?"** — chunking strategy + FastEmbed/BGE embeddings + pgvector top-k + hybrid core-card, with provenance metadata enabling citations. (You already demonstrate this exact pipeline on the site — mention DocIntel.)
- **"How did you handle hallucination?"** — grounded-or-refuse: if retrieval confidence is low, the assistant declines instead of inventing; every claim is cited to a source; LLM-as-judge faithfulness in CI catches regressions.
- **"How did you measure retrieval quality?"** — a labelled eval set, retrieval hit-rate / recall@k, and groundedness scores tracked over time in Langfuse and gated in CI.
- **"How did you cut voice-to-response latency?"** — sentence-level pipelining, streaming STT/LLM/TTS, speculative retrieval on partial transcripts, caching, region co-location; quote your p50/p90 before vs after.
- **"How does lip-sync work?"** — audio-driven viseme detection (Web Audio energy/formant → morph targets) with optional TTS-viseme driving for phoneme accuracy; explain the accuracy trade-off honestly.
- **"What if the LLM fails?"** — timeout + automatic provider fallback + graceful "let me point you to the project page" degradation + spend-cap kill switch.
- **"How is it deployed / kept safe?"** — Dockerised backend on Render/Fly, CORS-locked, rate-limited, injection-guarded, monitored, spend-capped; CI runs evals on every deploy.

The meta-point for a recruiter: this isn't "I added a chatbot," it's "I built a grounded, evaluated, observable, cost-bounded real-time LLM system and can defend every decision." That's the AI-Engineer signal.

---

## 7. Final recommendation

**Build it. Ship the text RAG MVP publicly within a week; add voice and the avatar as clearly-scoped follow-ups. Do not lead with the avatar and do not pay per-minute avatar APIs.**

- **Recommended architecture:** static frontend (GitHub Pages, unchanged) + FastAPI backend (streaming, grounded RAG, multi-provider fallback, thin tool use) + client-side three.js/RPM avatar with audio-driven lip-sync. SSE for text, WebSocket for voice, WebRTC only if you later adopt Realtime.
- **Recommended stack:** FastAPI · FastEmbed/BGE · pgvector or Chroma · Gemini Flash / Groq-Llama primary + fallback provider · Web Speech → Deepgram (STT) · ElevenLabs Flash or Azure (TTS) · three.js + Ready Player Me + TalkingHead.js · wawa-lipsync · Langfuse · Docker on Render/Fly.
- **MVP scope:** grounded streaming text chat with citations + refusal + a small eval set. No voice, no avatar.
- **Estimated effort:** MVP ~1 week; production voice ~2.5 weeks cumulative; full avatar build ~4–5 weeks cumulative (solo, with a 3D learning ramp).
- **Estimated running cost:** ~**$0–5/month** at portfolio traffic (browser STT free, cheap LLM pennies, free-tier backend; TTS is the only real variable — cap it, cache canned lines, or use browser TTS as fallback). Add a hard monthly spend cap regardless.
- **Development sequence:** Knowledge → Chat MVP → Eval/Observability → TTS → STT → Avatar → Lip-sync → Latency → Prod → Analytics.
- **Biggest technical risks:** (1) avatar/lip-sync scope creep on the least-differentiating part — mitigate by shipping text first and using a 2D fallback; (2) latency feeling broken — mitigate with streaming/pipelining from day one; (3) public abuse / bill run-up — mitigate with rate limits, injection guards, and a spend cap; (4) mobile performance from three.js — mitigate with lazy-loading and a text-only default.

**One-line verdict:** it's worth building *because* the parts that make it worth building are the parts a recruiter can't see — so build those first, well, and let the avatar be the last 15%.

---

### Sources (verify before committing; this market shifts monthly)
- OpenAI Realtime API pricing/latency (2026): https://www.layer3labs.io/guides/openai-realtime-api-pricing · https://tokenmix.ai/blog/openai-realtime-voice-api-2026-cost-latency
- ElevenLabs Flash latency/streaming (2026): https://vexyl.ai/elevenlabs-tts-latency-test-2026-real-world-results/ · https://elevenlabs.io/blog/enhancing-conversational-ai-latency-with-efficient-tts-pipelines
- Deepgram vs AssemblyAI streaming STT (2026): https://www.gladia.io/blog/assemblyai-vs-deepgram · https://deepgram.com/learn/assemblyai-vs-deepgram
- TalkingHead.js (Ready Player Me + visemes): https://github.com/met4citizen/TalkingHead
- wawa-lipsync (browser real-time lip-sync): https://github.com/wass08/wawa-lipsync · https://wawasensei.dev/tuto/real-time-lipsync-web
- Interactive avatar API landscape/pricing (2026): https://medium.com/@ggarciabernardo/the-live-avatar-landscape-apis-transport-and-subjective-evaluation-of-10-leading-providers-5b5b6e8a54dc · https://www.toughtongueai.com/blog/best-virtual-avatar-solutions-2026
- LLM API pricing (2026): https://www.cloudzero.com/blog/llm-api-pricing-comparison/ · https://www.requesty.ai/blog/cheapest-llm-api-prices-compared-2026
- RAG vs long-context / embeddings (2026): https://www.mindstudio.ai/blog/llm-wiki-vs-rag-knowledge-base · https://fast.io/resources/best-embedding-models-for-rag-agents/
