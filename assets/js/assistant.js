/* ═══════════════════════════════════════════
   AI COMPANION (bunny) WIDGET
   Streams grounded answers over SSE, speaks them (voice-out), listens (voice-in),
   and keeps the bunny present across chat-only / voice-only / chat+voice modes.
   Vanilla JS, no dependencies.
═══════════════════════════════════════════ */
(function () {
  "use strict";

  const root = document.getElementById("assistant-root");
  if (!root) return;

  // small reusable bunny mark for chat message avatars
  const BUNNY_SVG =
    '<svg class="bunny-svg" viewBox="0 0 48 48" fill="none">' +
    '<ellipse cx="17" cy="12" rx="4.2" ry="10" fill="#e9eef8" transform="rotate(-8 17 12)"/>' +
    '<ellipse cx="17" cy="12" rx="1.9" ry="7" fill="#22d3ee" transform="rotate(-8 17 12)"/>' +
    '<ellipse cx="31" cy="12" rx="4.2" ry="10" fill="#e9eef8" transform="rotate(8 31 12)"/>' +
    '<ellipse cx="31" cy="12" rx="1.9" ry="7" fill="#22d3ee" transform="rotate(8 31 12)"/>' +
    '<circle cx="24" cy="30" r="13" fill="#e9eef8"/>' +
    '<circle cx="19.6" cy="28.5" r="2.2" fill="#0b1020"/>' +
    '<circle cx="28.4" cy="28.5" r="2.2" fill="#0b1020"/>' +
    '<circle cx="24" cy="33" r="1.6" fill="#818cf8"/></svg>';

  // ------- config: backend base URL ------- //
  function resolveApiBase() {
    const strip = (s) => (s || "").trim().replace(/\/$/, "");
    if (strip(window.ASSISTANT_API_BASE)) return strip(window.ASSISTANT_API_BASE);
    if (strip(root.dataset.apiBase)) return strip(root.dataset.apiBase);
    const h = location.hostname;
    const isLocal =
      !h ||
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(h) ||
      h.endsWith(".local") ||
      /^192\.168\./.test(h) ||
      /^10\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    if (isLocal) return `http://${h && h !== "0.0.0.0" ? h : "localhost"}:8000`;
    return "";
  }
  const API_BASE = resolveApiBase();

  const els = {
    fab: document.getElementById("asstFab"),
    backdrop: document.getElementById("asstBackdrop"),
    panel: document.getElementById("asstPanel"),
    chat: document.getElementById("asstChat"),
    voiceBtn: document.getElementById("asstVoice"),
    expand: document.getElementById("asstExpand"),
    close: document.getElementById("asstClose"),
    info: document.getElementById("asstInfo"),
    stage: document.getElementById("asstStage"),
    caption: document.getElementById("asstCaption"),
    body: document.getElementById("asstBody"),
    voiceBar: document.getElementById("asstVoiceBar"),
    voiceState: document.getElementById("asstVoiceState"),
    retry: document.getElementById("asstRetry"),
    inputRow: document.getElementById("asstInputRow"),
    mic: document.getElementById("asstMic"),
    input: document.getElementById("asstInput"),
    send: document.getElementById("asstSend"),
  };

  const SUGGESTIONS = [
    "Tell me about his recent GenAI project",
    "What AI/ML work has he done?",
    "Why is he a good fit for an AI Engineer role?",
  ];

  let busy = false;
  let greeted = false;
  let opened = false;
  let expanded = false;
  let chatOn = true;
  let voiceOn = false;
  let lastError = "";
  let lastAsked = "";

  /* ---------- caption (voice-only) nodes ---------- */
  const capState = el("div", "asst-cap-state");
  const capText = el("div", "asst-cap-text");
  const capHint = el("div", "asst-cap-hint", "Tap the mic and ask a question.");
  els.caption.append(capState, capText, capHint);

  /* ---------- 3D avatar (lazy) ---------- */
  let avatar = null;
  let avatarStarted = false;
  function ensureAvatar() {
    if (avatarStarted) return;
    avatarStarted = true;
    if (!window.AssistantAvatar || !els.stage) {
      if (els.stage) els.stage.hidden = true;
      return;
    }
    avatar = window.AssistantAvatar();
    avatar.mount(els.stage).then((ok) => {
      if (!ok) {
        els.stage.hidden = true;
        avatar = null;
      } else {
        updateFraming();
      }
    });
  }
  function updateFraming() {
    if (!avatar || !avatar.setFraming) return;
    avatar.setFraming(!expanded ? "default" : voiceOnly() ? "portrait" : "bust");
  }

  /* ---------- voice-out (TTS) ---------- */
  const voice = window.AssistantVoice
    ? window.AssistantVoice({ apiBase: API_BASE })
    : null;
  if (voice) {
    voice.onState((speaking) => {
      els.panel.classList.toggle("asst-speaking", speaking);
      if (avatar) avatar.setSpeaking(speaking);
      if (voiceOn) {
        if (speaking) setVoiceState("speaking");
        else if (!mic || !mic.isListening()) setVoiceState("idle");
      }
    });
    voice.onBoundary(() => {
      if (avatar) avatar.pulse();
    });
    voice.onLevel((level) => {
      if (avatar) avatar.setMouth(level);
    });
  }

  /* ---------- voice-in (STT) ---------- */
  const mic = createMic();
  function createMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    let rec = null;
    let listening = false;
    function start(h) {
      if (listening) return;
      rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = "";
      rec.onstart = () => {
        listening = true;
        h.onStart && h.onStart();
      };
      rec.onresult = (e) => {
        let interim = "";
        finalText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        h.onInterim && h.onInterim((finalText || interim).trim());
      };
      rec.onerror = (e) => {
        h.onError && h.onError(e.error || "error");
      };
      rec.onend = () => {
        listening = false;
        h.onEnd && h.onEnd(finalText.trim());
      };
      try {
        rec.start();
      } catch (err) {
        h.onError && h.onError("start-failed");
      }
    }
    function stop() {
      if (rec && listening) {
        try {
          rec.stop();
        } catch (e) {}
      }
    }
    function abort() {
      if (rec) {
        try {
          rec.abort();
        } catch (e) {}
      }
      listening = false;
    }
    return { supported: true, start, stop, abort, isListening: () => listening };
  }

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function voiceOnly() {
    return voiceOn && !chatOn;
  }
  function scrollDown() {
    els.body.scrollTop = els.body.scrollHeight;
  }
  function focusInput() {
    if (chatOn && !els.input.disabled) setTimeout(() => els.input.focus(), 60);
  }

  /* ---------- open / close / expand ---------- */
  function open() {
    opened = true;
    els.panel.hidden = false;
    document.body.classList.add("asst-open");
    els.backdrop.hidden = !expanded;
    els.fab.setAttribute("aria-expanded", "true");
    ensureAvatar();
    if (avatar) avatar.resume();
    if (!greeted) {
      greeted = true;
      greet();
    }
    applyModes();
    focusInput();
  }
  function close() {
    opened = false;
    collapse();
    document.body.classList.remove("asst-open");
    els.fab.setAttribute("aria-expanded", "false");
    if (voice) voice.cancel();
    if (mic) mic.abort();
    if (avatar) avatar.pause();
    setTimeout(() => {
      if (!opened) els.panel.hidden = true;
    }, 240);
    els.fab.focus();
  }
  function collapse() {
    if (!expanded) return;
    expanded = false;
    document.body.classList.remove("asst-expanded");
    els.backdrop.hidden = true;
    updateExpandBtn();
    updateFraming();
  }
  function toggleExpand() {
    expanded = !expanded;
    document.body.classList.toggle("asst-expanded", expanded);
    els.backdrop.hidden = !expanded;
    updateExpandBtn();
    updateFraming();
  }
  function updateExpandBtn() {
    els.expand.setAttribute("aria-pressed", expanded ? "true" : "false");
    els.expand.title = expanded ? "Collapse" : "Expand";
    const i = els.expand.querySelector("i");
    if (i) i.className = expanded ? "fas fa-compress" : "fas fa-expand";
  }

  els.fab.addEventListener("click", open);
  els.close.addEventListener("click", close);
  els.expand.addEventListener("click", toggleExpand);
  els.backdrop.addEventListener("click", collapse);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opened) {
      if (expanded) collapse();
      else close();
    }
  });

  /* ---------- interaction modes ---------- */
  function applyModes() {
    els.chat.setAttribute("aria-pressed", chatOn ? "true" : "false");
    els.voiceBtn.setAttribute("aria-pressed", voiceOn ? "true" : "false");
    els.panel.classList.toggle("asst-voiceonly", voiceOnly());
    els.body.hidden = voiceOnly();
    els.caption.hidden = !voiceOnly();
    els.voiceBar.hidden = !voiceOn;
    els.mic.hidden = !voiceOn || !mic;
    if (voiceOn && !(voice && voice.isSpeaking())) setVoiceState("idle");
    updateFraming();
  }
  function setChat(v) {
    chatOn = v;
    if (!chatOn && !voiceOn) voiceOn = true; // never disable both
    if (!chatOn && !mic) chatOn = true; // no speech-recognition -> can't go voice-only
    persistVoice();
    applyModes();
    focusInput();
  }
  function setVoice(v) {
    voiceOn = v;
    if (!voiceOn && !chatOn) chatOn = true; // never disable both
    if (voice) voice.setEnabled(voiceOn);
    if (!voiceOn) {
      if (mic) mic.abort();
      if (avatar) avatar.setListening(false);
    }
    persistVoice();
    applyModes();
  }
  function persistVoice() {
    try {
      localStorage.setItem("asst-voice", voiceOn ? "1" : "0");
      localStorage.setItem("asst-chat", chatOn ? "1" : "0");
    } catch (e) {}
  }
  els.chat.addEventListener("click", () => setChat(!chatOn));
  els.voiceBtn.addEventListener("click", () => setVoice(!voiceOn));
  if (!mic) els.voiceBtn.title = "Voice output (mic input not supported here)";

  /* ---------- voice state indicator ---------- */
  function setVoiceState(s) {
    const map = {
      idle: ["", voiceOnly() ? "Tap the mic to talk" : "Ready"],
      listening: ["listening", "Listening…"],
      thinking: ["thinking", "Thinking…"],
      speaking: ["speaking", "Speaking…"],
      error: ["error", lastError || "Something went wrong"],
    };
    const spec = map[s] || map.idle;
    els.voiceState.dataset.state = spec[0];
    els.voiceState.textContent = "";
    els.voiceState.append(el("span", "asst-vstate-dot"), document.createTextNode(" " + spec[1]));
    els.retry.hidden = s !== "error";
    els.mic.classList.toggle("is-listening", s === "listening");
    if (capState) capState.textContent = s === "idle" ? "" : spec[1];
    if (capHint) capHint.hidden = s !== "idle";
    if (avatar) {
      avatar.setListening(s === "listening");
      avatar.setThinking(s === "thinking");
    }
  }

  /* ---------- mic flow ---------- */
  function startListening() {
    if (!mic || busy) return;
    if (mic.isListening()) {
      mic.stop();
      return;
    }
    if (voice) voice.cancel(); // barge-in
    lastError = "";
    capText.textContent = "";
    mic.start({
      onStart: () => setVoiceState("listening"),
      onInterim: (t) => {
        if (voiceOnly()) capText.textContent = t;
      },
      onError: (err) => handleMicError(err),
      onEnd: (finalText) => {
        if (finalText) ask(finalText);
        else if (els.voiceState.dataset.state !== "error") setVoiceState("idle");
      },
    });
  }
  function handleMicError(err) {
    if (err === "not-allowed" || err === "service-not-allowed")
      lastError = "Microphone access is blocked. Allow it in your browser, then retry.";
    else if (err === "no-speech") lastError = "I didn't catch that — tap retry and speak.";
    else if (err === "audio-capture") lastError = "No microphone was found.";
    else lastError = "Voice input hit a snag. Tap retry to try again.";
    setVoiceState("error");
    if (voiceOnly()) capText.textContent = lastError;
  }
  els.mic.addEventListener("click", startListening);
  els.retry.addEventListener("click", () => {
    setVoiceState("idle");
    startListening();
  });

  /* ---------- input handling ---------- */
  function syncSend() {
    els.send.disabled = busy || els.input.value.trim().length === 0;
  }
  els.input.addEventListener("input", () => {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 96) + "px";
    syncSend();
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  els.send.addEventListener("click", submit);
  function submit() {
    const text = els.input.value.trim();
    if (!text || busy) return;
    els.input.value = "";
    els.input.style.height = "auto";
    ask(text);
  }

  /* ---------- messages ---------- */
  function addMessage(role) {
    const msg = el("div", `asst-msg ${role}`);
    const ico = el("div", "asst-msg-ico");
    ico.innerHTML = role === "user" ? '<i class="fas fa-user"></i>' : BUNNY_SVG;
    const bubble = el("div", "asst-bubble");
    msg.append(ico, bubble);
    els.body.appendChild(msg);
    scrollDown();
    return bubble;
  }

  let suggestBlock = null;
  function greet() {
    const bubble = addMessage("bot");
    bubble.textContent =
      "Hi! I'm Subodh's AI companion. Ask me about his projects, skills, experience, or the things he's building.";
    suggestBlock = el("div", "asst-suggest-block");
    const wrap = el("div", "asst-suggest");
    SUGGESTIONS.forEach((s) => {
      const b = el("button", null, s);
      b.addEventListener("click", () => {
        if (!busy) ask(s);
      });
      wrap.appendChild(b);
    });
    suggestBlock.appendChild(wrap);
    els.body.appendChild(suggestBlock);
    scrollDown();
  }
  function clearSuggestions() {
    if (suggestBlock) {
      suggestBlock.remove();
      suggestBlock = null;
    }
  }

  function renderSources(bubble, sources) {
    if (!sources || !sources.length) return;
    const wrap = el("div", "asst-sources");
    sources.slice(0, 4).forEach((s) => {
      const a = el("a", "asst-source-chip", s.heading || s.source);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = `${s.source} · ${s.heading}`;
      wrap.appendChild(a);
    });
    bubble.appendChild(wrap);
    scrollDown();
  }
  function renderActions(bubble, actions) {
    if (!actions || !actions.length) return;
    const wrap = el("div", "asst-actions");
    actions.forEach((a) => {
      let node;
      if (a.type === "open_resume") {
        node = el("a", "asst-action");
        node.href = a.url;
        node.target = "_blank";
        node.rel = "noopener";
        node.innerHTML = '<i class="fas fa-file-alt"></i>';
        node.append(" " + (a.label || "View résumé"));
      } else {
        node = el("button", "asst-action");
        node.innerHTML = '<i class="fas fa-long-arrow-alt-down"></i>';
        node.append(" " + (a.label || "Go to section"));
        node.addEventListener("click", () => goToSection(a));
      }
      wrap.appendChild(node);
    });
    bubble.appendChild(wrap);
    scrollDown();
  }
  function renderFeedback(bubble, question) {
    const row = el("div", "asst-feedback");
    row.append(el("span", "asst-fb-q", "Was this helpful?"));
    const mk = (rating, icon, label) => {
      const b = el("button", "asst-fb-btn");
      b.innerHTML = `<i class="fas fa-${icon}"></i>`;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.addEventListener("click", () => {
        row.querySelectorAll("button").forEach((x) => (x.disabled = true));
        b.classList.add("sel");
        if (API_BASE)
          fetch(`${API_BASE}/feedback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question, rating }),
          }).catch(() => {});
      });
      return b;
    };
    row.append(mk("up", "thumbs-up", "Helpful"), mk("down", "thumbs-down", "Not helpful"));
    bubble.appendChild(row);
    scrollDown();
  }

  function goToSection(a) {
    let id = a.section_id;
    if (!id && a.url && a.url.includes("#")) id = a.url.split("#").pop();
    const target = id && document.getElementById(id);
    if (target) {
      if (expanded) collapse();
      if (window.matchMedia("(max-width: 560px)").matches) close();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("asst-flash");
      setTimeout(() => target.classList.remove("asst-flash"), 1600);
    } else if (a.url) {
      window.open(a.url, "_blank", "noopener");
    }
  }

  /* ---------- ask + SSE stream ---------- */
  async function ask(text) {
    busy = true;
    syncSend();
    lastAsked = text;
    clearSuggestions();
    if (voice) {
      voice.cancel();
      voice.reset();
    }
    if (voiceOn) {
      setVoiceState("thinking");
      capText.textContent = "";
    }
    addMessage("user").textContent = text;

    const bubble = addMessage("bot");
    const typing = el("div", "asst-typing");
    typing.innerHTML = "<span></span><span></span><span></span>";
    bubble.appendChild(typing);

    if (!API_BASE) {
      typing.remove();
      bubble.textContent =
        "The companion is offline right now. In the meantime, feel free to browse the projects, experience, and skills sections below.";
      console.warn(
        "[assistant] No backend URL. Set window.ASSISTANT_API_BASE or data-api-base on #assistant-root."
      );
      if (voiceOn) setVoiceState("idle");
      busy = false;
      syncSend();
      return;
    }

    if (avatar) avatar.setThinking(true);
    const caret = el("span", "asst-caret");
    let answer = "";
    let started = false;
    let gotAnswer = false;

    const finish = () => {
      caret.remove();
      if (avatar) avatar.setThinking(false);
      if (voiceOn && !(voice && voice.isSpeaking())) setVoiceState("idle");
      if (gotAnswer) renderFeedback(bubble, text);
      busy = false;
      syncSend();
      scrollDown();
    };

    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (resp.status === 429) {
        typing.remove();
        const e = await resp.json().catch(() => ({}));
        bubble.textContent = e.error || "Too many requests — please wait a moment.";
        return finish();
      }
      if (!resp.ok || !resp.body) throw new Error("HTTP " + resp.status);

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const evt = JSON.parse(line.slice(5).trim());

          if (evt.type === "token") {
            if (!started) {
              started = true;
              gotAnswer = true;
              if (avatar) avatar.setThinking(false);
              typing.remove();
              bubble.appendChild(caret);
            }
            answer += evt.text;
            caret.remove();
            bubble.textContent = answer;
            bubble.appendChild(caret);
            if (voiceOnly()) capText.textContent = answer.slice(-180);
            if (voice) voice.feed(evt.text);
            scrollDown();
          } else if (evt.type === "sources") {
            renderSources(bubble, evt.sources);
          } else if (evt.type === "actions") {
            renderActions(bubble, evt.actions);
          } else if (evt.type === "error") {
            if (!started) typing.remove();
            answer += (answer ? "\n\n" : "") + (evt.message || "Something went wrong.");
            bubble.textContent = answer;
          } else if (evt.type === "done") {
            if (voice) voice.flush();
          }
        }
      }
      if (!started) {
        typing.remove();
        bubble.textContent = "No response received.";
      }
    } catch (err) {
      typing.remove();
      bubble.textContent =
        "I couldn't reach the companion right now. Please try again in a moment.";
    } finally {
      finish();
    }
  }

  /* ---------- init from saved prefs ---------- */
  try {
    if (localStorage.getItem("asst-voice") === "1") voiceOn = true;
    if (localStorage.getItem("asst-chat") === "0") chatOn = false;
  } catch (e) {}
  if (!chatOn && !voiceOn) chatOn = true;
  if (voice && voiceOn) voice.setEnabled(true);
  updateExpandBtn();
})();
