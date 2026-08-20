/* ═══════════════════════════════════════════
   AI COMPANION (bunny) WIDGET
   Streams grounded answers over SSE (/chat), speaks them (/tts), listens (STT),
   and keeps the bunny present across all four interaction modes.
   Vanilla JS, no dependencies.

   State model — two classes and two attributes, nothing else:
     #assistant-root   class:       asst-open / asst-expanded
     #asstStage        data-state:  idle | listening | thinking | speaking | live
     #asstPanel        data-layout: chat | voice
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
    // shell
    fab: document.getElementById("asstFab"),
    fabStage: document.getElementById("asstFabStage"),
    fabPh: document.getElementById("asstFabPh"),
    backdrop: document.getElementById("asstBackdrop"),
    panel: document.getElementById("asstPanel"),
    expand: document.getElementById("asstExpand"),
    close: document.getElementById("asstClose"),
    info: document.getElementById("asstInfo"),
    statusText: document.getElementById("asstStatusText"),
    // the four modes
    chat: document.getElementById("asstChat"),
    voiceBtn: document.getElementById("asstVoice"),
    speak: document.getElementById("asstSpeak"),
    live: document.getElementById("asstLive"),
    // stage + overlays
    stage: document.getElementById("asstStage"),
    liveLines: document.getElementById("asstLiveLines"),
    hud: document.getElementById("asstHud"),
    hudLabel: document.getElementById("asstHudLabel"),
    wave: document.getElementById("asstWave"),
    stop: document.getElementById("asstStop"),
    caption: document.getElementById("asstCaption"),
    // transcript + composer
    body: document.getElementById("asstBody"),
    foot: document.getElementById("asstFoot"),
    voiceBar: document.getElementById("asstVoiceBar"),
    orbBtn: document.getElementById("asstOrbBtn"),
    voiceState: document.getElementById("asstVoiceState"),
    retry: document.getElementById("asstRetry"),
    end: document.getElementById("asstEnd"),
    inputRow: document.getElementById("asstInputRow"),
    mic: document.getElementById("asstMic"),
    input: document.getElementById("asstInput"),
    send: document.getElementById("asstSend"),
  };

  // fail loud in dev if the partial and this map ever drift apart
  const missing = Object.keys(els).filter((k) => !els[k]);
  if (missing.length) {
    console.error("[assistant] missing elements in the partial:", missing.join(", "));
    return;
  }

  /* ---------- the four interaction modes ---------- */
  const MODES = {
    chat:      { layout: "chat",  hud: false, mic: false, tts: false },
    listening: { layout: "voice", hud: true,  mic: true,  tts: false },
    speaking:  { layout: "voice", hud: true,  mic: false, tts: true  },
    live:      { layout: "voice", hud: true,  mic: true,  tts: true  },
  };
  const MODE_BTN = [
    ["chat", els.chat],
    ["listening", els.voiceBtn],
    ["speaking", els.speak],
    ["live", els.live],
  ];

  const SUGGESTIONS = [
    "Tell me about his recent GenAI project",
    "What AI/ML work has he done?",
    "Why is he a good fit for an AI Engineer role?",
  ];

  let mode = "chat";
  let stageState = "idle";
  let liveSub = ""; // "speaking" | "listening" — which half of a duplex turn
  let busy = false;
  let greeted = false;
  let opened = false;
  let expanded = false;
  let lastError = "";
  let capBuf = ""; // text currently shown in the HUD caption
  let streaming = false; // an answer is arriving token by token

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Keep the tail of a streaming answer, cut at a word boundary. Slicing by
  // raw character count chopped words in half ("trieval augmented …").
  function tailWords(text, max) {
    if (!text) return "";
    if (text.length <= max) return text;
    const cut = text.slice(-max);
    const sp = cut.search(/\s/);
    return (sp > -1 ? cut.slice(sp + 1) : cut).trimStart();
  }
  const liveTail = (t) => tailWords(t, 150);

  function scrollDown() {
    els.body.scrollTop = els.body.scrollHeight;
  }
  function focusInput() {
    if (!opened) return;
    // voice layouts have no text input, so focus the primary control instead —
    // otherwise focus is stranded on the launcher, which is now hidden
    const target =
      MODES[mode].layout === "chat" && !els.input.disabled
        ? els.input
        : MODES[mode].mic
        ? els.orbBtn
        : els.input;
    if (target && !target.hidden) setTimeout(() => target.focus(), 60);
  }

  /* ---------- what the bunny should feel about a given answer ----------
     Cheap, explainable heuristics over the text the backend already sends.
     Returns [emotion, intensity] or null to leave the mood alone. */
  function inferEmotion(txt) {
    if (!txt) return null;
    const t = txt.toLowerCase();
    if (/(i don't know|i do not know|no relevant|couldn't find|could not find|not in (his|the) portfolio|don't have (that|enough))/.test(t))
      return ["concerned", 0.85];
    if (/(sorry|unfortunately|afraid|went wrong|couldn't reach|too many requests)/.test(t))
      return ["concerned", 0.7];
    if (/(hahaha|haha\b.*haha|\blmao\b)/.test(t)) return ["laughing", 0.85];
    if (/(haha|\bha\b|\blol\b|funny|joking|kidding)/.test(t)) return ["amused", 0.9];
    if (/!/.test(txt) && /(great|awesome|love|amazing|proud|excited|delighted|thrilled)/.test(t))
      return ["excited", 0.85];
    if (/(built|shipped|designed|led|delivered|launched|architected)/.test(t))
      return ["happy", 0.6];
    if (/\?\s*$/.test(txt.trim())) return ["curious", 0.7];
    if (/(hi|hello|hey)\b/.test(t.slice(0, 12))) return ["happy", 0.7];
    return ["interested", 0.45];
  }

  /* ---------- 3D avatar (lazy, ONE instance with two homes) ----------
     The launcher and the panel stage show the same character, so they share a
     single WebGL context: it lives in #asstFabStage while the panel is closed
     and relocates into #asstStage on open. Two contexts would mean two bunnies
     with independently drifting blinks and gaze — visibly wrong for what is
     meant to read as one creature that walked into the conversation. */
  let avatar = null;
  let avatarStarted = false;
  let stageRO = null;
  let avatarHost = null;
  let companion = null;
  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function hostFor() {
    return opened ? els.stage : els.fabStage;
  }
  function ensureAvatar() {
    if (avatarStarted) return;
    avatarStarted = true;
    const host = hostFor();
    if (!window.AssistantAvatar || !host) {
      if (els.stage) els.stage.hidden = true;
      return;
    }
    avatar = window.AssistantAvatar();
    avatar.mount(host).then((ok) => {
      if (!ok) {
        // no WebGL / three.js blocked: the inline SVG bunny stays as the
        // launcher and the panel simply has no stage. Nothing else breaks.
        els.stage.hidden = true;
        avatar = null;
        return;
      }
      avatarHost = host;
      els.fab.classList.toggle("is-live", host === els.fabStage);
      applyBase();
      updateFraming();
      setState(stageState);
      // dock <-> expand animates the panel size, so measuring the stage on
      // click reads the OLD height. Watch the element and re-pick the framing
      // whenever it actually settles.
      if (window.ResizeObserver) {
        stageRO = new ResizeObserver(() => updateFraming());
        stageRO.observe(els.stage);
      }
    });
  }
  function moveAvatar() {
    if (!avatar || !avatar.remount) return;
    const host = hostFor();
    if (!host || host === avatarHost) return;
    if (avatar.remount(host)) {
      avatarHost = host;
      els.fab.classList.toggle("is-live", host === els.fabStage);
      applyBase();
      updateFraming();
    }
  }
  /* In the corner he rests on "interested" — brows a little up, ears up, a
     faint smile. In the panel the conversation drives the mood, so the floor
     goes back to neutral and nothing fights it. */
  function applyBase() {
    if (!avatar || !avatar.setBase) return;
    avatar.setBase(avatarHost === els.fabStage ? "interested" : "calm");
    // the playful behaviours only exist while he is standing in the corner
    if (companion) companion.setDocked(avatarHost === els.fabStage);
  }
  function updateFraming() {
    if (!avatar || !avatar.setFraming) return;
    // In the launcher the whole point is the full character, ears to feet.
    if (avatarHost === els.fabStage) return avatar.setFraming("launcher");
    // The rig uses a fixed vertical FOV, so what fits is purely a function of
    // camera distance, not of how big the stage is. "full" only pays off where
    // there is vertical room — in a short docked band it would shrink the face
    // to a thumbnail. Decide from the stage's measured height, which covers
    // docked, expanded and the stacked mobile layout in one rule.
    var h = els.stage.getBoundingClientRect().height;
    avatar.setFraming(h >= 320 ? "full" : "head");
  }

  /* Boot the rig into the launcher once the page is quiet. three.js is ~150KB
     from CDN and the corner bunny is decorative until clicked, so it must not
     compete with anything on the critical path. Hover/focus jumps the queue for
     someone who reaches for it before idle fires. */
  function bootLauncherAvatar() {
    if (avatarStarted || opened) return;
    ensureAvatar();
  }
  if (!reduceMotion) {
    const schedule = () =>
      window.requestIdleCallback
        ? window.requestIdleCallback(bootLauncherAvatar, { timeout: 3000 })
        : setTimeout(bootLauncherAvatar, 1400);
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
  }
  els.fab.addEventListener("pointerenter", () => {
    bootLauncherAvatar();
    if (avatar && avatar.react && avatarHost === els.fabStage) avatar.react("perk");
  });
  els.fab.addEventListener("focus", bootLauncherAvatar, { once: true });

  /* Ear-drag + attention messages. Behaviour only — it drives the rig above
     and the launcher element, and owns no bunny of its own. Tunables live in
     the CONFIG block at the top of assistant-companion.js. */
  if (window.AssistantCompanion) {
    companion = window.AssistantCompanion({
      fab: els.fab,
      getAvatar: () => avatar,
    });
    // handle for tuning from the console: __bunny.config.attention.cooldownMs = 5000,
    // __bunny.say("hi"), __bunny.express("annoyed")
    window.__bunny = companion;
  }

  // A corner animation must not burn a phone battery in a background tab.
  document.addEventListener("visibilitychange", () => {
    if (!avatar) return;
    if (document.hidden) avatar.pause();
    else avatar.resume();
  });

  /* ═══════════ DELTA 1 — stage state ═══════════ */
  /* Drives every CSS state layer and keeps the three.js rig in sync.
     Note: the handoff README maps `live` onto setSpeaking(true) for the whole
     session; that would hold the bunny's mouth open for the entire duplex
     call, so the rig follows the granular truth while the CSS gets "live". */
  function setState(s) {
    stageState = s;
    const visual = mode === "live" && s !== "idle" ? "live" : s;
    els.stage.dataset.state = visual;
    if (avatar) {
      avatar.setSpeaking(s === "speaking");
      avatar.setThinking(s === "thinking");
      avatar.setListening(s === "listening");
    }
    updateHud();
    updateVoiceState();
  }

  /* ---------- HUD copy (per-state table from the handoff README) ---------- */
  function setCaption(text, caret) {
    capBuf = text || "";
    // interim STT updates fire several times a second — announcing each one
    // makes a screen reader read the user's own words back as they speak
    els.caption.setAttribute("aria-live", stageState === "listening" ? "off" : "polite");
    els.caption.textContent = capBuf;
    if (caret) els.caption.appendChild(el("span", "asst-caption-caret", "|"));
  }
  function updateHud() {
    if (mode === "live") {
      // bubbles carry the words in live mode; the HUD just says who has the floor
      els.hudLabel.textContent = liveSub === "speaking" ? "bunny speaking" : "listening";
      setCaption("", false);
      return;
    }
    // The HUD only ever carries text while the mic is hot. Everything the
    // assistant says already appears in the transcript a few pixels away, so
    // echoing it over the bunny was duplicated content competing with the
    // character. Your own speech is the exception — it is not in the chat
    // until you stop talking.
    switch (stageState) {
      case "listening":
        els.hudLabel.textContent = "hearing you";
        setCaption(capBuf, true); // partial STT + blinking caret
        break;
      case "thinking":
        els.hudLabel.textContent = "retrieving";
        setCaption("", false);
        break;
      case "speaking":
        els.hudLabel.textContent = "speaking";
        setCaption("", false);
        break;
      default:
        if (streaming) {
          els.hudLabel.textContent = "answering";
          setCaption("", false);
          break;
        }
        els.hudLabel.textContent = lastError ? "trouble" : MODES[mode].mic ? "tap to talk" : "ready";
        setCaption(lastError || "", false);
    }
  }

  /* ---------- legacy voice-state pill (kept: it carries errors + retry) ---------- */
  function updateVoiceState() {
    const label = {
      idle: MODES[mode].mic ? "Tap the mic to talk" : "Ready",
      listening: "Listening…",
      thinking: "Thinking…",
      speaking: "Speaking…",
      error: lastError || "Something went wrong",
    };
    const s = lastError && stageState === "idle" ? "error" : stageState;
    els.voiceState.dataset.state = s === "idle" ? "" : s;
    els.voiceState.textContent = "";
    els.voiceState.append(el("span", "asst-vstate-dot"), document.createTextNode(" " + (label[s] || label.idle)));
    els.retry.hidden = s !== "error";
    syncComposer();
    els.mic.classList.toggle("is-listening", s === "listening");
    els.orbBtn.classList.toggle("is-listening", s === "listening");
    const icon = els.orbBtn.querySelector("i");
    if (icon) icon.className = s === "listening" ? "fas fa-stop" : "fas fa-microphone";
    els.orbBtn.setAttribute("aria-label", s === "listening" ? "Stop listening" : "Start listening");
  }

  /* ═══════════ DELTA 2 — four modes ═══════════ */
  function setMode(m) {
    if (!MODES[m]) return;
    const cfg = MODES[m];
    // no speech recognition available -> the mic-driven modes aren't reachable
    if (cfg.mic && !mic) m = cfg.tts ? "speaking" : "chat";
    mode = m;

    const c = MODES[mode];
    els.panel.dataset.layout = c.layout;
    els.hud.hidden = !c.hud;
    els.liveLines.hidden = mode !== "live";
    els.inputRow.hidden = mode === "live"; // live is hands-free
    syncComposer();
    MODE_BTN.forEach(([k, btn]) => btn.setAttribute("aria-pressed", String(k === mode)));

    // TTS follows the mode; this cancels playback but never the open SSE stream,
    // and the transcript in #asstBody is untouched, so switching mid-answer is safe.
    if (voice) voice.setEnabled(c.tts);
    if (!c.mic && mic) mic.abort();
    if (mode !== "live") {
      liveSub = "";
      els.liveLines.textContent = "";
    }

    persistMode();
    updateFraming();
    setState(stageState === "listening" && !c.mic ? "idle" : stageState);
    focusInput();
  }
  /* One mic, one status.
     Listening mode used to stack a big orb button ON TOP of the input row's
     own mic — two controls for the same thing — and print "Tap the mic to
     talk" right underneath a HUD already saying the same words over the
     bunny. So: wherever there is an input row, its mic IS the control and the
     HUD carries the state; the orb and the status bar only appear in live
     mode, which has no input row, or when there is an error to retry. */
  function syncComposer() {
    const c = MODES[mode];
    const errored = !!lastError;
    els.mic.hidden = !c.mic || mode === "live";
    els.orbBtn.hidden = mode !== "live";
    els.end.hidden = mode !== "live";
    els.voiceBar.hidden = mode !== "live" && !errored;
  }

  function persistMode() {
    try {
      localStorage.setItem("asst-mode", mode);
    } catch (e) {}
  }
  MODE_BTN.forEach(([k, btn]) => btn.addEventListener("click", () => setMode(k)));

  /* ═══════════ DELTA 3 — duplex bubbles (live mode) ═══════════ */
  function pushLiveLine(role, text) {
    if (!text) return null;
    const line = el("div", "asst-live-line " + (role === "user" ? "is-user" : "is-bot"), text);
    els.liveLines.appendChild(line);
    while (els.liveLines.children.length > 4) els.liveLines.firstChild.remove();
    return line; // callers stream into it while the answer arrives
  }

  /* ---------- voice-out (TTS) ---------- */
  const voice = window.AssistantVoice ? window.AssistantVoice({ apiBase: API_BASE }) : null;
  if (voice) {
    voice.onState((speaking) => {
      if (speaking) {
        // first TTS chunk actually playing -> "speaking"
        liveSub = "speaking";
        setState("speaking");
      } else {
        liveSub = "";
        if (mic && mic.isListening()) setState("listening");
        else if (!busy) setState("idle");
        else if (!streaming) setState("thinking"); // still retrieving
        // else: TTS is just between sentences while tokens keep arriving —
        // leave the stage alone rather than flapping back to "retrieving"
        setWaveAmp(null);
        // duplex: hand the floor back to the user
        if (mode === "live" && opened && !busy) startListening();
      }
    });
    voice.onBoundary(() => {
      if (avatar) avatar.pulse();
    });
    voice.onLevel((level) => {
      if (avatar) avatar.setMouth(level);
      setWaveAmp(level);
    });
    // real character alignment (ElevenLabs) or the current word (browser TTS)
    voice.onPhoneme((txt) => {
      if (avatar && avatar.setPhoneme) avatar.setPhoneme(txt);
    });
  }

  /* ---------- waveform amplitude ----------
     assistant-voice.js exposes onLevel() — a single 0..1 mouth-openness scalar,
     not a per-bin analyser — so the 20 bars keep their staggered self-animation
     and this scales the envelope (--amp) on top of it. Swap for per-bar
     `b.style.setProperty("--amp", …)` if voice.js ever exposes the analyser. */
  function setWaveAmp(level) {
    // onLevel(0) fires whenever TTS goes quiet — including at load. Treating
    // that as an amplitude pinned --amp at 0.25 and left the wave permanently
    // flat, so silence must clear the property and fall back to the CSS 1.
    if (level == null || level <= 0.03) els.wave.style.removeProperty("--amp");
    else els.wave.style.setProperty("--amp", (0.4 + Math.min(1, level) * 0.6).toFixed(3));
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

  /* ---------- open / close / expand ---------- */
  function open() {
    opened = true;
    els.panel.hidden = false;
    root.classList.add("asst-open");
    els.backdrop.hidden = !expanded;
    els.fab.setAttribute("aria-expanded", "true");
    if (companion) companion.setDocked(false);
    ensureAvatar();
    moveAvatar();
    if (avatar) avatar.resume();
    if (!greeted) {
      greeted = true;
      greet();
    }
    setMode(mode);
    focusInput();
  }
  function close() {
    opened = false;
    collapse();
    root.classList.remove("asst-open");
    els.fab.setAttribute("aria-expanded", "false");
    // cancel() alone only stops playback: the open SSE stream keeps calling
    // voice.feed(), so it would start speaking again after the panel closed
    if (voice) {
      voice.setEnabled(false);
      voice.cancel();
    }
    if (mic) mic.abort();
    // the bunny goes back to standing in the corner rather than being paused —
    // the launcher is still on screen, so freezing it would look like a crash
    moveAvatar();
    if (avatar && reduceMotion) avatar.pause();
    setState("idle");
    setTimeout(() => {
      if (!opened) els.panel.hidden = true;
    }, 240);
    els.fab.focus();
  }
  function collapse() {
    if (!expanded) return;
    expanded = false;
    root.classList.remove("asst-expanded");
    els.backdrop.hidden = true;
    updateExpandBtn();
    updateFraming();
  }
  function toggleExpand() {
    expanded = !expanded;
    root.classList.toggle("asst-expanded", expanded);
    els.backdrop.hidden = !expanded;
    updateExpandBtn();
    updateFraming();
  }
  function updateExpandBtn() {
    els.expand.setAttribute("aria-pressed", expanded ? "true" : "false");
    els.expand.title = expanded ? "Dock" : "Expand";
    els.expand.setAttribute("aria-label", expanded ? "Dock" : "Expand");
    const i = els.expand.querySelector("i");
    if (i)
      // FA6 names (…-from-center) do not exist in the vendored Font Awesome 5.10.1
      i.className = expanded ? "fas fa-compress" : "fas fa-expand";
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

  /* ---------- mic flow ---------- */
  function startListening() {
    if (!mic || busy) return;
    if (mic.isListening()) {
      mic.stop();
      return;
    }
    if (voice) voice.cancel(); // barge-in
    lastError = "";
    capBuf = "";
    liveSub = "listening";
    mic.start({
      onStart: () => setState("listening"),
      onInterim: (t) => {
        capBuf = t;
        updateHud();
      },
      onError: (err) => handleMicError(err),
      onEnd: (finalText) => {
        if (finalText) {
          if (mode === "live") pushLiveLine("user", finalText);
          ask(finalText);
        } else if (!lastError) {
          setState("idle");
        }
      },
    });
  }
  function handleMicError(err) {
    if (err === "not-allowed" || err === "service-not-allowed")
      lastError = "Microphone access is blocked. Allow it in your browser, then retry.";
    else if (err === "no-speech") lastError = "I didn't catch that — tap retry and speak.";
    else if (err === "audio-capture") lastError = "No microphone was found.";
    else lastError = "Voice input hit a snag. Tap retry to try again.";
    capBuf = lastError;
    setState("idle");
  }
  els.mic.addEventListener("click", startListening);
  els.orbBtn.addEventListener("click", startListening);
  els.retry.addEventListener("click", () => {
    lastError = "";
    setState("idle");
    startListening();
  });
  els.stop.addEventListener("click", () => {
    if (voice) voice.cancel();
    if (mic) mic.abort();
    setState("idle");
  });
  els.end.addEventListener("click", () => {
    if (voice) voice.cancel();
    if (mic) mic.abort();
    setMode("chat");
    setState("idle");
  });
  if (!mic) {
    els.voiceBtn.disabled = true;
    els.live.disabled = true;
    els.voiceBtn.title = "Voice input isn't supported in this browser";
    els.live.title = "Voice input isn't supported in this browser";
  }

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
    const msg = el("div", `asst-msg is-${role}`);
    const ico = el("span", "asst-msg-avatar");
    ico.setAttribute("aria-hidden", "true");
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
    suggestBlock = el("div", "asst-suggest");
    SUGGESTIONS.forEach((s) => {
      const b = el("button", "asst-chip", s);
      b.type = "button";
      b.addEventListener("click", () => {
        if (!busy) ask(s);
      });
      suggestBlock.appendChild(b);
    });
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
        node.type = "button";
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
      b.type = "button";
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
    clearSuggestions();
    lastError = "";
    if (voice) {
      voice.cancel();
      voice.reset();
    }
    // the bunny reacts to being asked something before it starts retrieving
    if (avatar && avatar.react) avatar.react(/\?\s*$/.test(text) ? "curious" : "perk");

    // the transcript always accumulates, in every mode
    addMessage("user").textContent = text;

    const bubble = addMessage("bot");
    const typing = el("div", "asst-typing");
    typing.innerHTML = "<i></i><i></i><i></i>";
    /* The answer node goes in NOW, empty, rather than when the first character
       is revealed. The reveal pump runs a frame later, so on a cache hit —
       where server.py emits token + sources + done in one tick — the citations
       were appended to the bubble BEFORE the answer node existed, and rendered
       above the text. */
    const answerEl = el("span", "asst-answer");
    bubble.append(answerEl, typing);

    if (!API_BASE) {
      typing.remove();
      answerEl.textContent =
        "The companion is offline right now. In the meantime, feel free to browse the projects, experience, and skills sections below.";
      console.warn(
        "[assistant] No backend URL. Set window.ASSISTANT_API_BASE or data-api-base on #assistant-root."
      );
      busy = false;
      setState("idle");
      syncSend();
      return;
    }

    const caret = el("span", "asst-caret");
    let answer = "";
    let started = false;
    let gotAnswer = false;
    let liveLine = null;   // the streaming bot bubble in live mode

    /* ---- reveal pump ----
       assistant/server.py does NOT always stream: a response-cache hit and the
       grounded-or-refuse guardrail each emit the whole answer as ONE token
       event, so repeated and off-topic questions used to slam in as a single
       block with no streaming at all. Rather than change the backend contract,
       incoming text is queued and revealed over ~250ms however it arrives.
       Genuine token-by-token deltas are tiny, so the queue drains within a
       frame or two and this adds no perceptible latency to them. */
    let pending = "";
    let revealRaf = null;
    let streamEnded = false;
    let onDrained = null;

    function revealStep() {
      if (!pending) {
        revealRaf = null;
        if (streamEnded && onDrained) { const r = onDrained; onDrained = null; r(); }
        return;
      }
      // Empty whatever is queued in ~15 frames (~250ms), but never slower than
      // 6 chars/frame (~360 chars/s) — that floor has to out-run a real token
      // stream, or the reveal falls steadily behind the text as it arrives.
      const n = Math.max(6, Math.ceil(pending.length / 15));
      const slice = pending.slice(0, n);
      pending = pending.slice(n);

      if (!started) {
        started = true;
        typing.remove();
        answerEl.after(caret);   // stays with the text, ahead of any citations
        streaming = true;
        // the first visible text means retrieval is over — "retrieving" must
        // not sit there while an answer is plainly arriving underneath it
        if (stageState === "thinking") setState(MODES[mode].tts ? "speaking" : "idle");
        if (mode === "live") liveLine = pushLiveLine("bot", "…");
      }

      answer += slice;
      answerEl.textContent = answer;      // citations/actions are siblings, untouched
      // (the answer is not mirrored into the HUD any more — it is already
      //  streaming into the transcript)
      if (liveLine) liveLine.textContent = liveTail(answer);
      if (voice) voice.feed(slice);       // speech tracks the visible text
      scrollDown();
      revealRaf = requestAnimationFrame(revealStep);
    }
    function pushText(t) {
      if (!t) return;
      pending += t;
      if (!revealRaf) revealRaf = requestAnimationFrame(revealStep);
    }
    function drained() {
      streamEnded = true;
      if (!pending && !revealRaf) return Promise.resolve();
      return new Promise((res) => { onDrained = res; });
    }

    let finished = false;
    const finish = () => {
      if (finished) return;   // the 429 branch returns finish(), then finally calls it again
      finished = true;
      caret.remove();
      if (gotAnswer) {
        var felt = inferEmotion(answer);
        if (felt && avatar && avatar.setEmotion) avatar.setEmotion(felt[0], felt[1]);
        renderFeedback(bubble, text);
        // the live bubble streamed as it arrived; just settle its final text
        if (liveLine) liveLine.textContent = liveTail(answer);
      }
      busy = false;
      streaming = false;
      syncSend();
      scrollDown();
      // TTS may still be playing; onState() will drop us to idle when it ends
      if (!(voice && voice.isSpeaking())) setState("idle");
    };

    try {
      // the SSE request is open -> "thinking"
      setState("thinking");
      const resp = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (resp.status === 429) {
        typing.remove();
        const e = await resp.json().catch(() => ({}));
        answerEl.textContent = e.error || "Too many requests — please wait a moment.";
        return finish();
      }
      if (!resp.ok || !resp.body) throw new Error("HTTP " + resp.status);

      let sawDone = false;
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
            gotAnswer = true;
            pushText(evt.text);
          } else if (evt.type === "meta") {
            // server.py opens every answer with a meta frame; it was being
            // silently discarded and #asstStatusText never updated
            if (evt.grounded === false && avatar && avatar.setEmotion)
              avatar.setEmotion("concerned", 0.9);
            els.statusText.textContent = evt.grounded === false
              ? "no match · answering from nothing is not allowed"
              : (evt.cached ? "grounded · cached" : "grounded · cites its sources");
          } else if (evt.type === "sources") {
            renderSources(bubble, evt.sources);
          } else if (evt.type === "actions") {
            renderActions(bubble, evt.actions);
          } else if (evt.type === "error") {
            gotAnswer = true;
            pushText((answer || pending ? "\n\n" : "") + (evt.message || "Something went wrong."));
          } else if (evt.type === "done") {
            sawDone = true;
          }
        }
      }
      await drained();
      if (voice && sawDone) voice.flush();
      if (!started) {
        typing.remove();
        answerEl.textContent = "No response received.";
      }
    } catch (err) {
      typing.remove();
      answerEl.textContent =
        "I couldn't reach the companion right now. Please try again in a moment.";
    } finally {
      await drained();          // reveal whatever is still queued, even on error
      finish();
    }
  }

  /* ---------- init ---------- */
  try {
    const saved = localStorage.getItem("asst-mode");
    if (saved && MODES[saved]) mode = saved;
  } catch (e) {}
  updateExpandBtn();
  setMode(mode);
  setState("idle");
})();
