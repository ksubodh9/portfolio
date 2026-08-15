/* ═══════════════════════════════════════════
   ASSISTANT VOICE — dual-engine text-to-speech
   Phase 3 (voice-out) + tighter Phase 6 (lip-sync).

   Two engines behind one API:
     • "eleven"  — backend /tts proxy to ElevenLabs (higher quality). Returns audio
                   + character-level timings, so the avatar mouth is driven precisely
                   from the alignment (word/character-timed lip-sync).
     • "browser" — SpeechSynthesis fallback (free, no key). Used when the backend
                   has no ElevenLabs key, or if a TTS request fails.

   Both stream sentence-by-sentence so speech starts while the answer is still
   generating. Public API (stable across engines):
     setEnabled / isEnabled / isSpeaking / reset / feed / flush / cancel
     onState(fn:bool) / onBoundary(fn) / onLevel(fn:0..1)
   onLevel emits a precise mouth-openness signal during ElevenLabs playback.
═══════════════════════════════════════════ */
(function () {
  "use strict";

  var synth = window.speechSynthesis || null;
  var MIN_SPEAK_LEN = 8;

  function createVoice(opts) {
    opts = opts || {};
    var apiBase = (opts.apiBase || "").replace(/\/$/, "");

    var enabled = false;
    var buffer = "";
    var engine = null; // 'eleven' | 'browser' — decided on first use
    var backendBad = false; // true once /tts is known unavailable
    var speaking = false;
    var onState = function () {};
    var onBoundary = function () {};
    var onLevel = function () {};

    /* ---------- shared: sentence extraction ---------- */
    function reset() {
      buffer = "";
    }
    function feed(delta) {
      if (!enabled || !delta) return;
      buffer += delta;
      drain();
    }
    function flush() {
      if (!enabled) return;
      var rest = buffer.trim();
      buffer = "";
      if (rest) enqueue(rest);
    }
    function drain() {
      var guard = 0;
      while (guard++ < 60) {
        var idx = boundaryIndex(buffer);
        if (idx < 0) break;
        var sentence = buffer.slice(0, idx + 1).trim();
        var rest = buffer.slice(idx + 1);
        if (sentence.length >= MIN_SPEAK_LEN) {
          buffer = rest;
          enqueue(sentence);
        } else {
          break; // too short; wait for more text
        }
      }
    }
    function boundaryIndex(text) {
      for (var i = 0; i < text.length; i++) {
        var c = text[i];
        if (c === "." || c === "!" || c === "?") {
          var next = text[i + 1];
          if (next === undefined || next === " " || next === "\n") {
            var prev = text[i - 1];
            if (c === "." && /\d/.test(prev || "") && /\d/.test(next || "")) continue;
            return i;
          }
        }
      }
      return -1;
    }

    /* ---------- dispatch ---------- */
    function enqueue(sentence) {
      if (engine === null) engine = apiBase && !backendBad ? "eleven" : "browser";
      if (engine === "eleven") elevenEnqueue(sentence);
      else browserEnqueue(sentence);
    }

    function setSpeaking(v) {
      if (v === speaking) return;
      speaking = v;
      if (v) startKeepAlive();
      else {
        stopKeepAlive();
        try {
          onLevel(0);
        } catch (e) {}
      }
      try {
        onState(v);
      } catch (e) {}
    }

    /* ═══════════ ElevenLabs engine ═══════════ */
    var jobs = [];
    var playIndex = 0;
    var fetching = false;
    var audioEl = null;
    var lipRaf = null;

    // Web Audio analyser -> real amplitude drives the mouth (audio-reactive).
    var actx = null,
      analyser = null,
      srcNode = null,
      timeData = null;
    function ensureCtx() {
      if (actx) return actx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC();
        analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.55;
        timeData = new Uint8Array(analyser.fftSize);
        analyser.connect(actx.destination); // connect once
      } catch (e) {
        actx = null; // no Web Audio -> fall back to alignment-based mouth
      }
      return actx;
    }
    function rms() {
      if (!analyser) return null;
      analyser.getByteTimeDomainData(timeData);
      var sum = 0;
      for (var i = 0; i < timeData.length; i++) {
        var v = (timeData[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / timeData.length); // ~0..0.5 typical for speech
    }

    function elevenEnqueue(text) {
      jobs.push({ text: text, status: "pending", audio: null, align: null });
      pumpFetch();
    }
    function pumpFetch() {
      if (fetching || backendBad || engine !== "eleven") return;
      var job = jobs.find(function (j) {
        return j.status === "pending";
      });
      if (!job) return;
      fetching = true;
      job.status = "fetching";
      fetch(apiBase + "/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: job.text }),
      })
        .then(function (r) {
          if (r.status === 503) throw { fallback: true };
          if (!r.ok) throw new Error("tts " + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.audio_base64) throw new Error("empty tts");
          job.audio = "data:audio/mpeg;base64," + data.audio_base64;
          job.align = normalizeAlign(data.alignment);
          job.status = "ready";
        })
        .catch(function () {
          // 503 (no key) OR backend unreachable / any error -> use browser TTS
          fallbackToBrowser();
        })
        .finally(function () {
          fetching = false;
          pumpFetch(); // prefetch next (no-op once switched to browser)
          maybePlay(); // no-op once switched to browser
        });
    }
    function normalizeAlign(a) {
      if (!a || !a.characters) return null;
      var chars = a.characters;
      var starts = a.character_start_times_seconds || [];
      var ends = a.character_end_times_seconds || [];
      var open = new Array(chars.length);
      for (var i = 0; i < chars.length; i++) open[i] = opennessFor(chars[i]);
      return { chars: chars, starts: starts, ends: ends, open: open };
    }
    function opennessFor(ch) {
      if (!ch) return 0;
      ch = ch.toLowerCase();
      if (ch === " " || ch === "\n" || ch === "\t") return 0.0;
      if (".,!?;:\"'".indexOf(ch) >= 0) return 0.0;
      if ("aeiouy".indexOf(ch) >= 0) return 0.95;
      if ("mbp".indexOf(ch) >= 0) return 0.06;
      if ("fvwl".indexOf(ch) >= 0) return 0.3;
      return 0.45;
    }
    function maybePlay() {
      if (engine !== "eleven") return; // switched to browser fallback
      if (audioEl) return; // already playing
      // skip failed jobs in order
      while (jobs[playIndex] && jobs[playIndex].status === "failed") playIndex++;
      var job = jobs[playIndex];
      if (!job) {
        // nothing queued; if nothing pending/fetching, we're done speaking
        if (!jobs.some(isActive)) setSpeaking(false);
        return;
      }
      if (job.status !== "ready") return; // wait for fetch
      playJob(job);
    }
    function isActive(j) {
      return j.status === "pending" || j.status === "fetching" || j.status === "ready";
    }
    function playJob(job) {
      setSpeaking(true);
      audioEl = new Audio(job.audio);
      // route through the analyser so the mouth follows real speech amplitude
      var ctx = ensureCtx();
      if (ctx) {
        try {
          if (ctx.state === "suspended") ctx.resume();
          srcNode = ctx.createMediaElementSource(audioEl);
          srcNode.connect(analyser);
        } catch (e) {
          srcNode = null;
        }
      }
      audioEl.play().catch(function () {
        // autoplay blocked or decode error -> browser fallback
        disconnectSrc();
        audioEl = null;
        fallbackToBrowser();
      });
      startLipSync(job);
      audioEl.onended = audioEl.onerror = function () {
        stopLipSync();
        disconnectSrc();
        audioEl = null;
        playIndex++;
        maybePlay();
      };
    }
    function disconnectSrc() {
      if (srcNode) {
        try {
          srcNode.disconnect();
        } catch (e) {}
      }
      srcNode = null;
    }
    function startLipSync(job) {
      stopLipSync();
      var align = job.align;
      var level = 0;
      var ptr = 0;
      function step() {
        if (!audioEl) return;
        var target;
        var a = srcNode ? rms() : null;
        if (a != null) {
          // real amplitude -> mouth openness (gain + soft knee), audio-reactive
          target = Math.min(1, a * 3.4);
        } else if (align && align.starts.length) {
          // no Web Audio -> character-timed openness from alignment
          var t = audioEl.currentTime;
          while (ptr < align.starts.length - 1 && align.starts[ptr + 1] <= t) ptr++;
          while (ptr > 0 && align.starts[ptr] > t) ptr--;
          target = align.open[ptr] || 0;
        } else {
          target = 0.3 + Math.abs(Math.sin(audioEl.currentTime * 12)) * 0.5;
        }
        // attack faster than release so it tracks onsets but doesn't chatter
        var k = target > level ? 0.5 : 0.28;
        level += (target - level) * k;
        try {
          onLevel(level);
        } catch (e) {}
        lipRaf = requestAnimationFrame(step);
      }
      lipRaf = requestAnimationFrame(step);
    }
    function stopLipSync() {
      if (lipRaf) cancelAnimationFrame(lipRaf);
      lipRaf = null;
      try {
        onLevel(0);
      } catch (e) {}
    }
    function elevenCancel() {
      if (audioEl) {
        try {
          audioEl.pause();
        } catch (e) {}
      }
      disconnectSrc();
      audioEl = null;
      stopLipSync();
      jobs = [];
      playIndex = 0;
      fetching = false;
    }
    function fallbackToBrowser() {
      backendBad = true;
      engine = "browser";
      // speak whatever hasn't played yet via the browser engine
      var pending = jobs.slice(playIndex).filter(function (j) {
        return j.status !== "failed";
      });
      elevenCancel();
      pending.forEach(function (j) {
        browserEnqueue(j.text);
      });
    }

    /* ═══════════ Browser engine (SpeechSynthesis) ═══════════ */
    var bQueue = [];
    var bVoice = null;
    function pickVoice() {
      if (!synth) return;
      var vs = synth.getVoices() || [];
      bVoice =
        vs.find(function (v) {
          return /en-US/i.test(v.lang) && /Google US English|Samantha|Aria|Jenny|Zira/i.test(v.name);
        }) ||
        vs.find(function (v) {
          return /en/i.test(v.lang);
        }) ||
        vs[0] ||
        null;
    }
    if (synth) {
      pickVoice();
      synth.addEventListener && synth.addEventListener("voiceschanged", pickVoice);
    }
    function browserEnqueue(text) {
      if (!synth) return;
      bQueue.push(text);
      if (!speaking) browserNext();
    }
    function browserNext() {
      if (!synth) return;
      if (!bQueue.length) {
        setSpeaking(false);
        return;
      }
      setSpeaking(true);
      var u = new SpeechSynthesisUtterance(bQueue.shift());
      if (bVoice) u.voice = bVoice;
      u.rate = 1.03;
      u.onboundary = function (e) {
        try {
          onBoundary({ charIndex: e.charIndex, name: e.name });
        } catch (err) {}
      };
      u.onend = u.onerror = browserNext;
      synth.speak(u);
    }

    /* ---------- Chrome long-speech keep-alive (browser engine) ---------- */
    var keepAlive = null;
    function startKeepAlive() {
      stopKeepAlive();
      keepAlive = setInterval(function () {
        if (synth && synth.speaking && engine === "browser") {
          synth.pause();
          synth.resume();
        }
      }, 10000);
    }
    function stopKeepAlive() {
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
    }

    /* ---------- public ---------- */
    function cancel() {
      buffer = "";
      bQueue.length = 0;
      if (synth) {
        try {
          synth.cancel();
        } catch (e) {}
      }
      elevenCancel();
      setSpeaking(false);
    }
    function setEnabled(v) {
      enabled = !!v && supported();
      if (!enabled) cancel();
      else if (synth) {
        try {
          synth.cancel();
        } catch (e) {}
      }
      return enabled;
    }
    function supported() {
      return !!synth || !!apiBase;
    }

    return {
      supported: supported,
      setEnabled: setEnabled,
      isEnabled: function () {
        return enabled;
      },
      isSpeaking: function () {
        return speaking;
      },
      reset: reset,
      feed: feed,
      flush: flush,
      cancel: cancel,
      onState: function (fn) {
        onState = fn || function () {};
      },
      onBoundary: function (fn) {
        onBoundary = fn || function () {};
      },
      onLevel: function (fn) {
        onLevel = fn || function () {};
      },
    };
  }

  window.AssistantVoice = createVoice;
})();
