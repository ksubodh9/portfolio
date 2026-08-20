/* ═══════════════════════════════════════════
   ASSISTANT COMPANION — playful behaviours for the corner bunny

   This file adds behaviour only. It owns no geometry and draws no bunny: it
   drives the existing rig (assistant-avatar.js) and the existing launcher
   element, in the same way assistant-voice.js drives speech. Two responsibilities:

     1. EAR DRAG  — grab an ear, pull the bunny off its home position, watch it
                    react, let go, watch it recoil and spring home.
     2. ATTENTION — an occasional short speech bubble, on deterministic triggers
                    with a hard cooldown. Deliberately dumb and predictable.

   Everything tunable lives in CONFIG at the top. Nothing below it needs editing
   to change timings, distances, messages or expressions.

   Public API:
     setDocked(bool)   — is the bunny currently in the launcher? (false = in the
                         chat panel, where every behaviour here is suspended)
     say(text)         — force a bubble now, ignoring triggers (for debugging)
     express(name)     — force an expression: idle | curious | surprised |
                         annoyed | happy | talking
     destroy()
═══════════════════════════════════════════ */
(function () {
  "use strict";

  var CONFIG = {
    /* ---- ear drag ---- */
    drag: {
      // how far (px) the bunny may be pulled from home before it stops following
      maxDistance: 92,
      // px of movement before a press counts as a drag rather than a click
      startThreshold: 4,
      // how forgiving the ear hit-test is, in px around the projected ear
      earHitRadius: 26,
      // 0..1 — how much of the cursor's travel the bunny actually follows.
      // Below 1 the ear visibly stretches before the body starts moving.
      sensitivity: 0.72,
      // fraction of maxDistance past which he stops being amused about it
      annoyedAt: 0.62,
      // px of window edge he will not be dragged past
      viewportMargin: 8,
    },
    /* ---- spring home ---- */
    spring: {
      stiffness: 170,   // higher = snappier return
      damping: 13,      // lower = more bounce on the way back
      restEpsilon: 0.35,
    },
    /* ---- attention messages ---- */
    attention: {
      messages: [
        "Hey… you 👀",
        "Looking for something specific?",
        "Need help?",
        "Let's chat?",
        "Hmm… what are you looking for?",
        "I'm here.",
      ],
      firstDelayMs: 28000,   // never before this long after load
      cooldownMs: 80000,     // minimum gap between two messages
      messageMs: 5000,       // how long a bubble stays up
      idleMs: 4000,          // "user has gone quiet" threshold
      awayMs: 20000,         // tab hidden at least this long counts as a return
      afterDragMs: 900,      // beat before he comments on being pulled
      maxPerSession: 4,      // hard stop, so he can never become wallpaper
      tickMs: 1000,          // how often triggers are evaluated
    },
    /* ---- expressions: the six states, mapped onto the rig's emotion table ---- */
    faces: {
      idle:      { base: "interested" },
      curious:   { emotion: "curious",   amount: 0.6 },
      surprised: { emotion: "surprised", amount: 0.9 },
      annoyed:   { emotion: "annoyed",   amount: 0.75 },
      happy:     { emotion: "happy",     amount: 0.7 },
      talking:   { emotion: "attentive", amount: 0.55 },
    },
  };

  function createCompanion(opts) {
    opts = opts || {};
    var fab = opts.fab;
    var getAvatar = opts.getAvatar || function () { return null; };
    if (!fab) return null;

    var reduce =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var docked = true;          // bunny is in the launcher (not the chat panel)
    var destroyed = false;

    /* ─────────── expressions ─────────── */
    var face = "idle";
    function express(name) {
      var spec = CONFIG.faces[name];
      var a = getAvatar();
      if (!spec || !a) return;
      face = name;
      if (spec.base && a.setBase) a.setBase(spec.base);
      if (spec.emotion && a.setEmotion) a.setEmotion(spec.emotion, spec.amount);
    }
    function toIdle() {
      var a = getAvatar();
      if (a && a.setBase) a.setBase(CONFIG.faces.idle.base);
      face = "idle";
    }

    /* ═════════════ 1. EAR DRAG ═════════════
       Home is wherever CSS puts the launcher; this only ever applies a
       transform offset on top of it, so the bunny can never be permanently
       repositioned — releasing always springs (x, y) back to (0, 0). */
    var x = 0, y = 0, vx = 0, vy = 0;   // offset from home, px
    var dragging = false;
    var grabbedEar = 0;                  // -1 left, +1 right
    var pointerId = null;
    var startX = 0, startY = 0;
    var moved = 0;
    var springRaf = null;
    var lastT = 0;

    function applyOffset() {
      fab.style.transform = x || y ? "translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px)" : "";
    }

    function springStep(now) {
      if (destroyed) return;
      var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
      lastT = now;
      var k = CONFIG.spring.stiffness, c = CONFIG.spring.damping;
      vx += -x * k * dt; vx *= Math.exp(-c * dt); x += vx * dt;
      vy += -y * k * dt; vy *= Math.exp(-c * dt); y += vy * dt;
      applyOffset();
      var still =
        Math.abs(x) < CONFIG.spring.restEpsilon && Math.abs(y) < CONFIG.spring.restEpsilon &&
        Math.abs(vx) < 6 && Math.abs(vy) < 6;
      if (still) {
        x = y = vx = vy = 0;
        applyOffset();
        springRaf = null;
        lastT = 0;
        fab.classList.remove("is-dragging");
        return;
      }
      springRaf = requestAnimationFrame(springStep);
    }
    function startSpring() {
      if (springRaf) return;
      lastT = 0;
      springRaf = requestAnimationFrame(springStep);
    }

    function earAt(clientX, clientY) {
      var a = getAvatar();
      // Only trust the rig once it is actually rendering. `avatar` exists the
      // instant mount() is called but earHit() returns 0 until the scene is
      // built — which silently killed the drag for anyone who grabbed an ear
      // during the three.js load, and permanently under reduced motion.
      if (a && a.earHit && a.isReady && a.isReady()) {
        return a.earHit(clientX, clientY, CONFIG.drag.earHitRadius) || 0;
      }
      // No rig rendering yet (static SVG placeholder): treat the top third of
      // the launcher as ear territory, split down the middle.
      var r = fab.getBoundingClientRect();
      if (clientY > r.top + r.height * 0.34) return 0;
      return clientX < r.left + r.width / 2 ? -1 : 1;
    }

    function onDown(e) {
      if (!docked || dragging || e.button > 0) return;
      var ear = earAt(e.clientX, e.clientY);
      if (!ear) return;                 // not an ear: leave it a normal button
      grabbedEar = ear;
      dragging = true;
      moved = 0;
      startX = e.clientX - x;
      startY = e.clientY - y;
      pointerId = e.pointerId;
      if (springRaf) { cancelAnimationFrame(springRaf); springRaf = null; lastT = 0; }
      vx = vy = 0;
      fab.classList.add("is-dragging");
      try { fab.setPointerCapture(pointerId); } catch (err) {}
      express("surprised");
      var a = getAvatar();
      if (a && a.react) a.react("startle");
    }

    function onMove(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      e.preventDefault();
      var dx = (e.clientX - startX) * CONFIG.drag.sensitivity;
      var dy = (e.clientY - startY) * CONFIG.drag.sensitivity;
      var d = Math.hypot(dx, dy);
      var max = CONFIG.drag.maxDistance;
      if (d > max) { dx *= max / d; dy *= max / d; d = max; }

      // He can be pulled about, but not out of the window. Clamp against the
      // launcher's HOME rect (current rect minus the offset already applied),
      // or a full downward tug drops most of him below the fold.
      var r = fab.getBoundingClientRect();
      var homeL = r.left - x, homeT = r.top - y;
      var m = CONFIG.drag.viewportMargin;
      dx = Math.max(m - homeL, Math.min(window.innerWidth - m - homeL - r.width, dx));
      dy = Math.max(m - homeT, Math.min(window.innerHeight - m - homeT - r.height, dy));
      d = Math.hypot(dx, dy);
      moved = Math.max(moved, Math.hypot(e.clientX - startX - x, e.clientY - startY - y));
      x = dx; y = dy;
      applyOffset();

      var t = max ? d / max : 0;
      // tell the rig where the ear is being taken, in its own normalized units
      var a = getAvatar();
      if (a && a.setEarPull) a.setEarPull(grabbedEar, dx / max, -dy / max, t);

      // he tolerates a gentle tug; past annoyedAt he has opinions
      var want = t > CONFIG.drag.annoyedAt ? "annoyed" : t > 0.22 ? "surprised" : "curious";
      if (want !== face) express(want);
    }

    function onUp(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      try { fab.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
      var a = getAvatar();
      if (a && a.releaseEarPull) a.releaseEarPull();
      // a small kick out of the pull direction reads as the ear snapping back
      vx = -x * 2.2; vy = -y * 2.2;
      startSpring();
      express("happy");
      if (a && a.react) a.react("amuse");
      window.setTimeout(function () {
        if (!dragging) toIdle();
      }, 1400);
      grabbedEar = 0;
      if (moved > CONFIG.drag.startThreshold) {
        // a drag must not fall through into "open the chat panel"
        suppressClick = true;
        window.setTimeout(function () { suppressClick = false; }, 60);
        maybeAttention("afterDrag");
      }
    }

    var suppressClick = false;
    function onClick(e) {
      if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
    }

    fab.addEventListener("pointerdown", onDown);
    fab.addEventListener("pointermove", onMove, { passive: false });
    fab.addEventListener("pointerup", onUp);
    fab.addEventListener("pointercancel", onUp);
    fab.addEventListener("click", onClick, true);

    /* ═════════════ 2. ATTENTION ═════════════
       Deterministic on purpose. One timer, a set of boolean gates, a hard
       cooldown and a session cap. No heuristics, nothing to misfire. */
    var bubble = null;
    var bubbleTimer = null;
    var shownAt = 0;
    var shownCount = 0;
    var msgIndex = Math.floor(Math.random() * CONFIG.attention.messages.length);
    var lastActivity = Date.now();
    var hiddenAt = 0;
    var pendingTrigger = null;
    var startedAt = Date.now();
    var speakTimer = null;

    function ensureBubble() {
      if (bubble) return bubble;
      bubble = document.createElement("span");
      bubble.className = "asst-fab-bubble";
      // the launcher's aria-label already describes the control; these are
      // ambient nudges, not content a screen reader needs read out of order
      bubble.setAttribute("aria-hidden", "true");
      fab.appendChild(bubble);
      return bubble;
    }

    function markActivity() { lastActivity = Date.now(); }

    function canInterrupt() {
      var now = Date.now();
      return (
        !destroyed && docked && !dragging &&
        !document.hidden &&
        !shownAt &&                                        // nothing on screen
        shownCount < CONFIG.attention.maxPerSession &&
        now - startedAt > CONFIG.attention.firstDelayMs &&
        now - lastShown > CONFIG.attention.cooldownMs
      );
    }
    var lastShown = -Infinity;

    function show(text) {
      var b = ensureBubble();
      b.textContent = text;
      // force a reflow so the transition runs from the hidden state
      void b.offsetWidth;
      b.classList.add("is-on");
      shownAt = Date.now();
      lastShown = shownAt;
      shownCount++;

      var a = getAvatar();
      if (a) {
        if (a.react) a.react("perk");        // looks up toward the message
        express("talking");
        mouthTheWords(text);
      }
      bubbleTimer = window.setTimeout(hide, CONFIG.attention.messageMs);
    }

    /* Drive the existing viseme path with the message text so the mouth
       actually forms the words instead of flapping. Same entry point the
       browser-TTS engine uses. */
    function mouthTheWords(text) {
      var a = getAvatar();
      if (!a || !a.setPhoneme || reduce) return;
      var chars = text.replace(/[^a-z ]/gi, "").split("");
      if (!chars.length) return;
      var i = 0;
      var step = Math.max(45, Math.min(90, (CONFIG.attention.messageMs * 0.62) / chars.length));
      if (a.setSpeaking) a.setSpeaking(true);
      clearInterval(speakTimer);
      speakTimer = window.setInterval(function () {
        var av = getAvatar();
        if (!av || i >= chars.length) {
          clearInterval(speakTimer); speakTimer = null;
          if (av && av.setSpeaking) av.setSpeaking(false);
          return;
        }
        av.setPhoneme(chars[i++]);
        if (av.setMouth) av.setMouth(0.35 + Math.random() * 0.45);
      }, step);
    }

    function hide() {
      clearTimeout(bubbleTimer); bubbleTimer = null;
      if (bubble) bubble.classList.remove("is-on");
      shownAt = 0;
      clearInterval(speakTimer); speakTimer = null;
      var a = getAvatar();
      if (a) {
        if (a.setSpeaking) a.setSpeaking(false);
        if (a.setMouth) a.setMouth(0);
      }
      toIdle();
    }

    function nextMessage() {
      var list = CONFIG.attention.messages;
      var m = list[msgIndex % list.length];
      msgIndex++;
      return m;
    }

    function maybeAttention(reason) {
      if (reason === "afterDrag") {
        pendingTrigger = { reason: reason, at: Date.now() + CONFIG.attention.afterDragMs };
        return;
      }
      if (!canInterrupt()) return;
      show(nextMessage());
    }

    function tick() {
      if (destroyed) return;
      var now = Date.now();
      if (pendingTrigger && now >= pendingTrigger.at) {
        pendingTrigger = null;
        if (canInterrupt()) { show(nextMessage()); return; }
      }
      if (!canInterrupt()) return;
      // trigger A: the user has gone quiet for a moment
      if (now - lastActivity > CONFIG.attention.idleMs) { show(nextMessage()); return; }
    }
    var interval = window.setInterval(tick, CONFIG.attention.tickMs);

    ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"].forEach(
      function (ev) {
        window.addEventListener(ev, markActivity, { passive: true });
      }
    );
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { hiddenAt = Date.now(); if (shownAt) hide(); return; }
      markActivity();
      // trigger B: they came back to the tab after a real absence
      if (hiddenAt && Date.now() - hiddenAt > CONFIG.attention.awayMs) {
        pendingTrigger = { reason: "return", at: Date.now() + 1200 };
      }
      hiddenAt = 0;
    });
    // clicking the bubble is the obvious thing to do when it says "Let's chat?"
    fab.addEventListener("click", function () { if (shownAt) hide(); });

    return {
      setDocked: function (v) {
        docked = !!v;
        if (!docked) {
          if (shownAt) hide();
          if (dragging) onUp();
          if (x || y) { x = y = vx = vy = 0; applyOffset(); fab.classList.remove("is-dragging"); }
        } else {
          toIdle();
        }
      },
      say: function (t) { if (docked && !shownAt) show(t || nextMessage()); },
      express: express,
      isDragging: function () { return dragging; },
      config: CONFIG,
      destroy: function () {
        destroyed = true;
        clearInterval(interval); clearTimeout(bubbleTimer); clearInterval(speakTimer);
        if (springRaf) cancelAnimationFrame(springRaf);
        if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
      },
    };
  }

  window.AssistantCompanion = createCompanion;
})();
