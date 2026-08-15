/* ═══════════════════════════════════════════
   ASSISTANT AVATAR — procedural 3D "AI bunny"
   Phase 5 (avatar) + light Phase 6 (lip-sync). Built entirely in three.js
   (lazy-loaded from CDN only when the assistant opens, to keep the main page fast).

   No external model or rig: the bunny is composed from primitives so it's free,
   self-contained, and themed to the site palette. Public API:
     mount(el) -> Promise<bool>   setSpeaking(bool)   pulse()   setThinking(bool)
     pause()   resume()   destroy()
   Lip-sync: setSpeaking()/pulse() are driven by the voice controller's
   onState/onBoundary events, so the mouth flaps in time with speech.
═══════════════════════════════════════════ */
(function () {
  "use strict";

  var THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";

  function loadThree() {
    return new Promise(function (resolve, reject) {
      if (window.THREE) return resolve(window.THREE);
      var s = document.createElement("script");
      s.src = THREE_URL;
      s.async = true;
      s.onload = function () {
        window.THREE ? resolve(window.THREE) : reject(new Error("three missing"));
      };
      s.onerror = function () {
        reject(new Error("three failed to load"));
      };
      document.head.appendChild(s);
    });
  }

  // palette (matches portfolio-ai.css)
  var COL = {
    fur: 0xe9eef8,
    furShade: 0xcfd8ea,
    innerEar: 0x22d3ee,
    eye: 0x0b1020,
    glint: 0xbff4ff,
    nose: 0x818cf8,
    mouth: 0x1a2338,
    glow: 0x22d3ee,
  };

  // camera framings — the render loop eases toward the active one.
  //   default  : floating widget (head + shoulders, ears with breathing room)
  //   bust     : expanded two-column (tighter on the head, less torso)
  //   portrait : expanded voice-only (largest head, face as the focus)
  var FRAMES = {
    default: { pos: [0, 0.55, 7.1], look: [0, 0.55, 0] },
    bust: { pos: [0, 0.66, 5.5], look: [0, 0.66, 0] },
    portrait: { pos: [0, 0.72, 4.9], look: [0, 0.72, 0] },
  };

  function createAvatar() {
    var THREE,
      container,
      renderer,
      scene,
      camera,
      raf = null,
      ready = false,
      ro = null;
    var root, head, earL, earR, eyeL, eyeR, lidL, lidR, nose, mouth, glow;
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // an organic "eased random waypoint" channel — picks a new random target at
    // irregular intervals and eases toward it. Layering several of these (with
    // different timings) makes motion look procedural, never looped.
    function chan() {
      return { v: 0, tgt: 0, tn: Math.random() * 2 };
    }
    function wander(ch, dt, minI, maxI, ease) {
      ch.tn -= dt;
      if (ch.tn <= 0) {
        ch.tgt = Math.random() * 2 - 1;
        ch.tn = minI + Math.random() * (maxI - minI);
      }
      ch.v += (ch.tgt - ch.v) * Math.min(1, dt * ease);
      return ch.v; // eased, ~[-1, 1]
    }

    var state = {
      speaking: false,
      thinking: false,
      listening: false,
      t: 0,
      last: 0,
      // mouth
      mouth: 0,
      prevMouth: 0,
      extMouth: 0, // externally-driven level (audio amplitude / alignment)
      extMouthAt: 0,
      // head pose
      hYaw: chan(),
      hPitch: chan(),
      hRoll: chan(),
      lean: 0,
      tilt: 0,
      nod: 0,
      emphCd: 0,
      // ears
      earPerk: 0,
      earLw: chan(),
      earRw: chan(),
      flickL: { v: 0 },
      flickR: { v: 0 },
      flickTimer: 3,
      // eyes
      gazeX: chan(),
      gazeY: chan(),
      eyeBaseX: 0.4,
      eyeBaseY: 0.06,
      blinkTimer: 1.5,
      blinking: false,
      blinkPhase: 0,
      didDouble: false,
      lidExpr: 0,
      // procedural speech envelope (browser TTS, no audio access)
      mSyl: chan(),
      mPhr: chan(),
      // camera framing
      tPos: FRAMES.default.pos.slice(),
      tLook: FRAMES.default.look.slice(),
      curLook: FRAMES.default.look.slice(),
    };

    function mat(color, opts) {
      opts = opts || {};
      return new THREE.MeshStandardMaterial({
        color: color,
        roughness: opts.rough != null ? opts.rough : 0.72,
        metalness: opts.metal != null ? opts.metal : 0.05,
        emissive: opts.emissive != null ? opts.emissive : 0x000000,
        emissiveIntensity: opts.emi != null ? opts.emi : 1,
      });
    }

    function ellipsoid(r, sx, sy, sz, material) {
      var g = new THREE.SphereGeometry(r, 32, 24);
      var m = new THREE.Mesh(g, material);
      m.scale.set(sx, sy, sz);
      return m;
    }

    function buildBunny() {
      root = new THREE.Group();

      var furMat = mat(COL.fur, { rough: 0.8 });
      var earInnerMat = mat(COL.innerEar, { emissive: COL.innerEar, emi: 0.35, rough: 0.5 });

      // torso (bust — mostly framed out at the bottom)
      var torso = ellipsoid(1, 0.85, 0.95, 0.75, mat(COL.furShade, { rough: 0.85 }));
      torso.position.set(0, -1.15, 0);
      root.add(torso);

      // head
      head = new THREE.Group();
      head.position.set(0, 0.5, 0);
      root.add(head);

      var skull = ellipsoid(0.95, 1.05, 1.0, 0.98, furMat);
      head.add(skull);

      // muzzle / cheeks
      var cheekL = ellipsoid(0.34, 1, 0.8, 1, furMat);
      cheekL.position.set(-0.32, -0.28, 0.7);
      var cheekR = cheekL.clone();
      cheekR.position.x = 0.32;
      head.add(cheekL, cheekR);

      // ears (long, upright, slightly splayed)
      function makeEar(side) {
        var ear = new THREE.Group();
        var outer = ellipsoid(0.34, 0.6, 1.45, 0.32, furMat);
        var inner = ellipsoid(0.34, 0.38, 1.22, 0.3, earInnerMat);
        inner.position.z = 0.09;
        ear.add(outer, inner);
        // pivot the ear from its base so "perk up" rotations look natural
        outer.position.y = 0.45;
        inner.position.y = 0.45;
        ear.position.set(side * 0.42, 0.9, -0.05);
        ear.rotation.z = side * -0.16;
        ear.rotation.x = -0.12;
        ear.userData.side = side;
        return ear;
      }
      earL = makeEar(-1);
      earR = makeEar(1);
      head.add(earL, earR);

      // eyes (calm, slightly narrowed for a "thoughtful" look) + glint
      var eyeMat = mat(COL.eye, { rough: 0.25, metal: 0.1 });
      var glintMat = new THREE.MeshBasicMaterial({ color: COL.glint });
      function makeEye(side) {
        var g = new THREE.Group();
        var ball = ellipsoid(0.19, 1, 0.86, 1, eyeMat);
        var glint = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), glintMat);
        glint.position.set(side * 0.05, 0.06, 0.17);
        g.add(ball, glint);
        g.position.set(side * 0.4, 0.06, 0.82);
        return g;
      }
      eyeL = makeEye(-1);
      eyeR = makeEye(1);
      head.add(eyeL, eyeR);

      // eyelids (fur-coloured caps that drop to blink)
      function makeLid(side) {
        var lid = ellipsoid(0.2, 1, 0.6, 1, furMat);
        lid.position.set(side * 0.4, 0.32, 0.83);
        lid.scale.y = 0.05; // open
        return lid;
      }
      lidL = makeLid(-1);
      lidR = makeLid(1);
      head.add(lidL, lidR);

      // nose
      nose = ellipsoid(0.1, 1.2, 0.9, 1, mat(COL.nose, { emissive: COL.nose, emi: 0.25 }));
      nose.position.set(0, -0.18, 1.0);
      head.add(nose);

      // mouth (small; scales open while speaking)
      mouth = ellipsoid(0.12, 1.1, 0.35, 0.6, mat(COL.mouth, { rough: 0.5 }));
      mouth.position.set(0, -0.42, 0.92);
      head.add(mouth);

      // soft AI aura behind the head
      var glowMat = new THREE.MeshBasicMaterial({
        color: COL.glow,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      glow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), glowMat);
      glow.position.set(0, 0.4, -1.1);
      root.add(glow);

      scene.add(root);
    }

    function buildScene() {
      scene = new THREE.Scene();

      var w = container.clientWidth || 360;
      var h = container.clientHeight || 220;
      camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
      // framing eases toward state.tPos / state.tLook (see FRAMES).
      camera.position.set(state.tPos[0], state.tPos[1], state.tPos[2]);
      state.curLook = state.tLook.slice();
      camera.lookAt(state.curLook[0], state.curLook[1], state.curLook[2]);

      scene.add(new THREE.AmbientLight(0xffffff, 0.62));
      var key = new THREE.DirectionalLight(0xffffff, 0.85);
      key.position.set(2, 3, 4);
      scene.add(key);
      var rim = new THREE.PointLight(COL.glow, 0.9, 20);
      rim.position.set(-2.5, 1.5, -2);
      scene.add(rim);
      var fill = new THREE.DirectionalLight(0x9ec5ff, 0.3);
      fill.position.set(-3, -1, 2);
      scene.add(fill);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);
    }

    function resize() {
      if (!renderer || !container) return;
      var w = container.clientWidth,
        h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    function update(dt) {
      var s = state;
      s.t += dt;

      // ease camera toward the active framing (smooth expand/collapse transitions)
      var ck = Math.min(1, dt * 4);
      camera.position.x += (s.tPos[0] - camera.position.x) * ck;
      camera.position.y += (s.tPos[1] - camera.position.y) * ck;
      camera.position.z += (s.tPos[2] - camera.position.z) * ck;
      s.curLook[0] += (s.tLook[0] - s.curLook[0]) * ck;
      s.curLook[1] += (s.tLook[1] - s.curLook[1]) * ck;
      s.curLook[2] += (s.tLook[2] - s.curLook[2]) * ck;
      camera.lookAt(s.curLook[0], s.curLook[1], s.curLook[2]);

      var amp = reduce ? 0.25 : 1;
      var speaking = s.speaking,
        thinking = s.thinking,
        listening = s.listening;
      var mode = speaking ? 3 : thinking ? 2 : listening ? 1 : 0;

      // ---------- mouth: audio-amplitude driven, else procedural speech ---------- //
      var extFresh = performance.now() - s.extMouthAt < 160;
      var mTarget = 0;
      if (speaking) {
        if (extFresh) {
          mTarget = s.extMouth; // real TTS amplitude (ElevenLabs analyser)
        } else {
          // no audio access (browser TTS): synthesize a varied, non-looping envelope
          var syl = 0.5 + 0.5 * wander(s.mSyl, dt, 0.05, 0.13, 24); // syllable rate
          var phr = 0.5 + 0.5 * wander(s.mPhr, dt, 0.4, 1.1, 5); // phrase envelope
          var pause = phr < 0.16 ? 0 : 1; // natural pauses between phrases
          mTarget = syl * (0.35 + 0.65 * phr) * pause;
        }
      }
      // attack faster than release -> reads like real articulation
      var mk = mTarget > s.mouth ? Math.min(1, dt * 26) : Math.min(1, dt * 13);
      s.mouth += (mTarget - s.mouth) * mk;
      if (mouth) {
        mouth.scale.y = 0.32 + s.mouth * 2.5;
        mouth.scale.x = 1.12 - s.mouth * 0.28;
        mouth.position.y = -0.42 - s.mouth * 0.05;
      }

      // ---------- emphasis: nod/ear-flick on speech peaks (throttled + random) ---------- //
      var rising = s.mouth - s.prevMouth;
      s.prevMouth = s.mouth;
      s.emphCd -= dt;
      if (speaking && rising > 0.11 && s.emphCd <= 0 && Math.random() < 0.55) {
        s.nod = 0.5 + Math.random() * 0.5;
        if (Math.random() < 0.4)
          (Math.random() < 0.5 ? s.flickL : s.flickR).v = 0.8;
        s.emphCd = 0.5 + Math.random() * 0.9;
      }
      s.nod *= Math.exp(-dt * 5);

      // ---------- head: layered noise + eased mode pose + breathing ---------- //
      var leanT = listening ? -0.09 : thinking ? -0.02 : 0; // lean in when attentive
      var tiltT = thinking ? 0.13 : 0; // curious tilt when thinking
      s.lean += (leanT - s.lean) * Math.min(1, dt * 3);
      s.tilt += (tiltT - s.tilt) * Math.min(1, dt * 3);
      var act = (mode === 3 ? 1.0 : mode === 1 ? 0.5 : 0.75) * amp;
      var yaw = wander(s.hYaw, dt, 1.6, 4.2, 1.5) * 0.06 * act;
      var pit = wander(s.hPitch, dt, 1.9, 4.8, 1.5) * 0.035 * act;
      var rol = wander(s.hRoll, dt, 2.4, 5.6, 1.3) * 0.022 * act;
      if (head) {
        head.rotation.y = yaw;
        head.rotation.x = pit + s.lean - s.nod * 0.06; // nod dips the chin
        head.rotation.z = rol + s.tilt;
        head.position.y = 0.5 + Math.sin(s.t * 1.15) * 0.02 * amp; // breathing
      }
      if (root) root.scale.setScalar(1 + Math.sin(s.t * 1.15) * 0.005 * amp);
      if (glow)
        glow.material.opacity =
          0.07 +
          (speaking ? 0.05 * (0.4 + s.mouth) : thinking ? 0.05 : 0) +
          Math.sin(s.t * 1.7) * 0.015;

      // ---------- ears: perk + independent wander + occasional flick ---------- //
      var perkGoal = mode === 1 ? 1 : thinking ? 0.4 : 0;
      s.earPerk += (perkGoal - s.earPerk) * Math.min(1, dt * 5);
      s.flickL.v = Math.max(0, s.flickL.v - dt * 3.2);
      s.flickR.v = Math.max(0, s.flickR.v - dt * 3.2);
      s.flickTimer -= dt;
      if (s.flickTimer <= 0) {
        (Math.random() < 0.5 ? s.flickL : s.flickR).v = 0.7 + Math.random() * 0.3;
        s.flickTimer = 2.5 + Math.random() * 4.5;
      }
      var perkX = s.earPerk * 0.14;
      var ewL = wander(s.earLw, dt, 1.8, 4.5, 1.4) * 0.05 * amp;
      var ewR = wander(s.earRw, dt, 1.7, 4.3, 1.4) * 0.05 * amp;
      if (earL) {
        earL.rotation.z = -0.16 + s.earPerk * 0.06 + ewL - s.flickL.v * 0.18;
        earL.rotation.x = -0.12 + perkX + s.flickL.v * 0.05;
      }
      if (earR) {
        earR.rotation.z = 0.16 - s.earPerk * 0.06 + ewR + s.flickR.v * 0.18;
        earR.rotation.x = -0.12 + perkX + s.flickR.v * 0.05;
      }

      // ---------- eyes: gaze drift + look-away when thinking ---------- //
      var gx = wander(s.gazeX, dt, 1.4, 3.8, 2.2) * (thinking ? 0.05 : 0.028);
      var gy = wander(s.gazeY, dt, 1.7, 4.2, 2.2) * 0.02 + (thinking ? 0.02 : 0);
      if (eyeL) {
        eyeL.position.x = -s.eyeBaseX + gx;
        eyeL.position.y = s.eyeBaseY + gy;
      }
      if (eyeR) {
        eyeR.position.x = s.eyeBaseX + gx;
        eyeR.position.y = s.eyeBaseY + gy;
      }

      // ---------- blink: irregular, occasional double; half-lid when thinking ---------- //
      s.blinkTimer -= dt;
      if (!s.blinking && s.blinkTimer <= 0) {
        s.blinking = true;
        s.blinkPhase = 0;
      }
      var blinkClose = 0;
      if (s.blinking) {
        s.blinkPhase += dt * 11;
        var b = s.blinkPhase < 1 ? s.blinkPhase : 2 - s.blinkPhase; // 0->1->0
        blinkClose = Math.max(0, Math.min(1, b));
        if (s.blinkPhase >= 2) {
          s.blinking = false;
          if (!s.didDouble && Math.random() < 0.15) {
            s.didDouble = true;
            s.blinkTimer = 0.16; // quick second blink
          } else {
            s.didDouble = false;
            s.blinkTimer = 2.0 + Math.random() * 4.5 - (listening ? 0.5 : 0);
          }
        }
      }
      var expr = thinking ? 0.35 : 0; // slightly lowered lids when thinking
      s.lidExpr += (expr - s.lidExpr) * Math.min(1, dt * 4);
      var lidY = 0.05 + Math.max(blinkClose, s.lidExpr) * 0.95;
      if (lidL) lidL.scale.y = lidY;
      if (lidR) lidR.scale.y = lidY;
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      var dt = state.last ? (now - state.last) / 1000 : 0.016;
      state.last = now;
      if (dt > 0.1) dt = 0.1; // clamp after tab was hidden
      update(dt);
      renderer.render(scene, camera);
    }

    /* ---------- public API ---------- */
    function mount(el) {
      container = el;
      return loadThree()
        .then(function (t) {
          THREE = t;
          buildScene();
          buildBunny();
          if (window.ResizeObserver) {
            ro = new ResizeObserver(resize);
            ro.observe(container);
          } else {
            window.addEventListener("resize", resize);
          }
          ready = true;
          resume();
          return true;
        })
        .catch(function () {
          ready = false;
          return false;
        });
    }
    function setSpeaking(v) {
      state.speaking = !!v;
      if (!v) state.mouthTarget = 0;
    }
    function pulse() {
      // per-word emphasis (browser TTS boundary events): tiny nod + occasional flick
      if (!state.speaking) return;
      state.nod = Math.max(state.nod, 0.4);
      if (Math.random() < 0.3)
        (Math.random() < 0.5 ? state.flickL : state.flickR).v = 0.7;
    }
    function setMouth(v) {
      state.extMouth = Math.max(0, Math.min(1.2, v || 0));
      state.extMouthAt = performance.now();
    }
    function setThinking(v) {
      state.thinking = !!v;
    }
    function setListening(v) {
      state.listening = !!v;
    }
    function setFraming(name) {
      var f = FRAMES[name];
      if (!f) return;
      state.tPos = f.pos.slice();
      state.tLook = f.look.slice();
    }
    function pause() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      state.last = 0;
    }
    function resume() {
      if (!raf && ready) {
        state.last = 0;
        raf = requestAnimationFrame(loop);
      }
    }
    function destroy() {
      pause();
      if (ro) ro.disconnect();
      if (renderer) {
        renderer.dispose && renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode)
          renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      ready = false;
    }

    return {
      mount: mount,
      setSpeaking: setSpeaking,
      pulse: pulse,
      setMouth: setMouth,
      setThinking: setThinking,
      setListening: setListening,
      setFraming: setFraming,
      pause: pause,
      resume: resume,
      destroy: destroy,
      isReady: function () {
        return ready;
      },
    };
  }

  window.AssistantAvatar = createAvatar;
})();
