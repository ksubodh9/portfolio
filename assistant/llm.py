"""Multi-provider LLM abstraction with streaming + automatic fallback.

Mirrors the provider-abstraction pattern from DocIntel / LaraOpsCopilot:
primary provider first, fall through to the next on any error/timeout, and
finally degrade to a deterministic offline provider so the assistant NEVER
hard-fails in front of a visitor.

Providers stream token deltas (str). Selection is driven by which API keys are
present in the environment; order is configurable via LLM_PROVIDER_ORDER.
"""
from __future__ import annotations

import json
import os
import re
from typing import Iterator, Protocol

import httpx

REQUEST_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "20"))


class Provider(Protocol):
    name: str

    def available(self) -> bool: ...
    def stream(self, system: str, user: str) -> Iterator[str]: ...


# --------------------------------------------------------------------------- #
# Gemini (primary) — REST streamGenerateContent with SSE
# --------------------------------------------------------------------------- #
class GeminiProvider:
    name = "gemini"

    def __init__(self) -> None:
        self.key = os.environ.get("GEMINI_API_KEY", "")
        self.model = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

    def available(self) -> bool:
        return bool(self.key)

    def stream(self, system: str, user: str) -> Iterator[str]:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:streamGenerateContent"
        )
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
        }
        params = {"key": self.key, "alt": "sse"}
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            with client.stream("POST", url, params=params, json=payload) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if not data or data == "[DONE]":
                        continue
                    obj = json.loads(data)
                    for cand in obj.get("candidates", []):
                        for part in cand.get("content", {}).get("parts", []):
                            if part.get("text"):
                                yield part["text"]


# --------------------------------------------------------------------------- #
# Groq (fallback) — OpenAI-compatible chat completions, streamed
# --------------------------------------------------------------------------- #
class GroqProvider:
    name = "groq"

    def __init__(self) -> None:
        self.key = os.environ.get("GROQ_API_KEY", "")
        self.model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

    def available(self) -> bool:
        return bool(self.key)

    def stream(self, system: str, user: str) -> Iterator[str]:
        url = "https://api.groq.com/openai/v1/chat/completions"
        payload = {
            "model": self.model,
            "temperature": 0.2,
            "max_tokens": 512,
            "stream": True,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {"Authorization": f"Bearer {self.key}"}
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            with client.stream("POST", url, json=payload, headers=headers) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    obj = json.loads(data)
                    delta = obj["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta


# --------------------------------------------------------------------------- #
# Offline echo (last resort) — deterministic, grounded, no network
# --------------------------------------------------------------------------- #
class OfflineProvider:
    """Builds a short grounded answer from the retrieved context. Always available.

    Not an LLM — it extracts the most relevant sentences from the CONTEXT block so the
    system degrades gracefully (and stays testable offline) when no API key works.
    """

    name = "offline"

    def available(self) -> bool:
        return True

    def stream(self, system: str, user: str) -> Iterator[str]:
        answer = self._compose(user)
        for word in answer.split(" "):
            yield word + " "

    @staticmethod
    def _compose(user: str) -> str:
        # Pull the visitor question and the top retrieved chunk text.
        question = ""
        if "VISITOR QUESTION:" in user:
            question = user.split("VISITOR QUESTION:")[-1].split("Answer:")[0].strip()
        # First numbered context chunk body.
        snippet = ""
        marker = "\n[1] source:"
        if marker in user:
            block = user.split(marker, 1)[1]
            # keep only the first chunk's body — stop at the next "[n] source:" marker
            block = re.split(r"\n\[\d+\] source:", block, maxsplit=1)[0]
            lines = block.splitlines()
            snippet = " ".join(l.strip() for l in lines[1:] if l.strip())
            # strip the "[Heading]" prefix the chunker adds
            if snippet.startswith("["):
                snippet = snippet.split("]", 1)[-1].strip()
        snippet = re.sub(r"\s+", " ", snippet)[:500].strip()
        if not snippet:
            from prompt import REFUSAL_TEXT

            return REFUSAL_TEXT
        return f"Based on Subodh's portfolio: {snippet}"


def _build_chain() -> list[Provider]:
    registry = {
        "gemini": GeminiProvider(),
        "groq": GroqProvider(),
        "offline": OfflineProvider(),
    }
    order = os.environ.get("LLM_PROVIDER_ORDER", "gemini,groq,offline").split(",")
    chain: list[Provider] = []
    for name in [o.strip() for o in order if o.strip()]:
        p = registry.get(name)
        if p and p.available():
            chain.append(p)
    if not any(p.name == "offline" for p in chain):
        chain.append(registry["offline"])  # guarantee graceful degradation
    return chain


def stream_answer(system: str, user: str) -> Iterator[str]:
    """Yield token deltas from the first working provider; fall through on failure.

    Yields a leading control token '\x00PROVIDER:<name>' so callers can log which
    provider served the turn (stripped before display).
    """
    chain = _build_chain()
    last_err: Exception | None = None
    for provider in chain:
        try:
            gen = provider.stream(system, user)
            first = next(gen)  # force the request; errors surface here
            yield f"\x00PROVIDER:{provider.name}"
            yield first
            yield from gen
            return
        except Exception as e:  # noqa: BLE001 - fall through to next provider
            last_err = e
            continue
    raise RuntimeError(f"All providers failed. Last error: {last_err}")
