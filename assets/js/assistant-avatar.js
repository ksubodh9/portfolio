/* ═══════════════════════════════════════════
   ASSISTANT AVATAR — expressive procedural 3D "AI bunny"

   Same character as before: white/soft body, cyan inner ears, big dark glossy
   eyes, small violet nose, rounded muzzle, long upright ears. Built entirely
   from three.js primitives (lazy-loaded from CDN when the assistant opens),
   so it stays free, self-contained and themed to the site palette.

   What changed: the bunny is no longer a model with a few canned animations.
   It has a small facial rig, a continuous emotional state, viseme-based
   speech, and a scheduler of micro-behaviours, so it reads as present and
   attentive rather than as an animated object.

     • FACE RIG      ~24 blend parameters (brows, upper/lower lids, gaze,
                     mouth open/wide/curve/press, teeth, cheeks, ears, head).
                     Every parameter eases at its OWN rate, so the eyes react
                     before the ears, which react before the posture.
     • EMOTION       three layers blended continuously — a base state from the
                     conversation (calm / attentive / thinking / engaged), a
                     mood inferred from what is being said, and short-lived
                     reaction overlays. Never a hard cut between presets.
     • REACTIONS     progressive, not simultaneous: "curious" is eyes focus →
                     ear forward → head tilt → brow raise, spread over ~0.5s.
     • SPEECH        the mouth forms visemes (AA/E/I/O/U/M/F/L/S/R) rather than
                     opening and closing with volume. Driven by real character
                     alignment when the TTS engine provides it (see
                     assistant-voice.js onPhoneme), else synthesized.
     • ASYMMETRY     left and right brows, lids, mouth corners and ears each
                     carry their own offset and timing jitter.

   Public API (superset of the previous one — nothing was removed):
     mount(el) -> Promise<bool>   remount(el) -> bool
     pause()   resume()   destroy()   isReady()
     setSpeaking(bool)   setThinking(bool)   setListening(bool)   pulse()
     setMouth(level 0..1)         setFraming(name)
     setPhoneme(char)             — one character of speech, for visemes
     setEmotion(name, intensity)  — sustained mood, decays back on its own
     setBase(name)                — the resting face the blend falls back to
     setEarPull(side, nx, ny, amt) / releaseEarPull()   — drag an ear
     earHit(clientX, clientY, r)  — which ear is under a screen point
     react(name)                  — one-off progressive micro-reaction
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

  // palette (matches portfolio-ai.css) — unchanged, this is the character's identity
  var COL = {
    fur: 0xe9eef8,
    furShade: 0xcfd8ea,
    brow: 0xa8b4cc,
    innerEar: 0x22d3ee,
    eye: 0x0b1020,
    glint: 0xbff4ff,
    nose: 0x818cf8,
    mouth: 0x1a2338,
    tooth: 0xfdfefe,
    glow: 0x22d3ee,
  };

  /* Camera framings. Vertical FOV is fixed at 30°, so what fits is purely a
     function of distance: visible height = 2 * z * tan(15°) ≈ 0.536 * z.
       full     : whole character, ears to feet (needs ~4.2 units -> z 7.9)
       head     : ears + face filling a short wide band, body cropped at the chest
       default  : head + torso + arms, feet out of frame
       bust/portrait: closer head framings, kept for compatibility */
  var FRAMES = {
    full: { pos: [0, 0.32, 7.9], look: [0, 0.32, 0] },
    /* Launcher. The canvas there is deliberately taller and wider than the
       button (see .asst-fab-stage), and z is pulled back by the same ratio, so
       the bunny renders at exactly the same pixel size as `full` did while
       gaining frustum headroom. Without it an upward ear-drag clipped the ear
       tips against the top edge — at rest they cleared it by only 3px. The
       look height is raised so the feet stay put and all the new room goes
       above the ears, which is the only direction that needed it. */
    launcher: { pos: [0, 0.746, 10.5], look: [0, 0.746, 0] },
    head: { pos: [0, 0.9, 5.6], look: [0, 0.9, 0] },
    default: { pos: [0, 0.5, 6.6], look: [0, 0.5, 0] },
    bust: { pos: [0, 0.66, 5.5], look: [0, 0.66, 0] },
    portrait: { pos: [0, 0.72, 4.9], look: [0, 0.72, 0] },
  };

  /* ─────────── the face rig ───────────
     Every expression in this file is a partial set of these. Anything not
     named falls back to 0 (neutral), so specs stay readable. */
  var PARAMS = [
    "browRaiseL", "browRaiseR",   // -1 lowered .. +1 raised
    "browTiltL", "browTiltR",     // -1 outer-up (angry) .. +1 inner-up (sad)
    "lidUpperL", "lidUpperR",     // -1 extra open .. +1 closed
    "lidLowerL", "lidLowerR",     //  0 relaxed .. +1 raised (squint / real smile)
    "eyeWide",                    //  0 .. 1
    "gazeX", "gazeY",             // -1 .. 1
    "mouthOpen",                  //  0 .. 1
    "mouthWide",                  // -1 rounded (O/U) .. +1 wide (E/I)
    "mouthCurveL", "mouthCurveR", // -1 frown .. +1 smile, per corner
    "mouthPress",                 //  0 .. 1 lips pressed thin
    "teeth",                      //  0 .. 1 incisors showing
    "cheekRaise",                 //  0 .. 1
    "noseTwitch",                 //  0 .. 1
    "earL", "earR",               // -1 droop/back .. +1 forward/upright
    "armRaiseL", "armRaiseR",     // -1 tucked in .. +1 lifted away from the body
    "headTilt", "headNod",        // -1 .. 1
    "posture",                    // -1 slump .. +1 upright
  ];

  // Which channel each parameter eases on. Different speeds are the whole
  // point: a face where everything arrives together looks mechanical.
  var SPEED = {
    browRaiseL: 7, browRaiseR: 7, browTiltL: 6.5, browTiltR: 6.5,
    lidUpperL: 13, lidUpperR: 13, lidLowerL: 10, lidLowerR: 10,
    eyeWide: 14, gazeX: 16, gazeY: 16,
    mouthOpen: 18, mouthWide: 15, mouthCurveL: 8, mouthCurveR: 8,
    mouthPress: 9, teeth: 7, cheekRaise: 6, noseTwitch: 12,
    earL: 4.5, earR: 4.2, headTilt: 3, headNod: 5, posture: 1.8,
    armRaiseL: 5, armRaiseR: 4.6,
  };

  /* Emotions. Keys without an L/R suffix are expanded to both sides, then a
     small per-side asymmetry is layered on at runtime. */
  var EMOTIONS = {
    neutral: {},
    calm: { mouthCurve: 0.16, ear: 0.08, posture: 0.1 },
    attentive: { browRaise: 0.28, eyeWide: 0.22, ear: 0.75, lidUpper: -0.08, posture: 0.3 },
    curious: {
      browRaiseL: 0.6, browRaiseR: 0.18, headTilt: 0.5,
      earL: 0.75, earR: 0.25, mouthCurve: 0.18, eyeWide: 0.25,
    },
    interested: { browRaise: 0.4, eyeWide: 0.3, ear: 0.6, mouthCurve: 0.3, posture: 0.35 },
    confused: {
      browRaiseL: 0.55, browRaiseR: -0.28, browTiltR: -0.3, headTilt: -0.45,
      earL: 0.2, earR: -0.55, mouthCurve: -0.12, mouthWide: -0.22, mouthPress: 0.25,
    },
    thinking: {
      gazeX: -0.6, gazeY: 0.34, lidUpper: 0.3, browRaiseL: -0.05, browRaiseR: -0.18,
      headTilt: 0.28, earL: -0.1, earR: -0.2, mouthPress: 0.35, mouthCurve: 0.05,
    },
    thoughtful: {
      gazeX: 0.55, gazeY: 0.28, browRaiseL: 0.22, lidUpper: 0.26,
      mouthPress: 0.3, headTilt: 0.3, earL: -0.08, earR: 0.16,
    },
    understanding: { browRaise: 0.3, mouthCurve: 0.4, ear: 0.45, headNod: 0.3, lidLower: 0.15 },
    happy: {
      mouthCurve: 0.78, cheekRaise: 0.62, lidLower: 0.38, browRaise: 0.22,
      ear: 0.5, posture: 0.3,
    },
    amused: {
      mouthCurveL: 0.55, mouthCurveR: 0.88, cheekRaise: 0.42, lidLower: 0.58,
      browRaiseL: 0.32, browRaiseR: 0.1, ear: 0.35, headTilt: 0.2,
    },
    laughing: {
      mouthOpen: 0.66, mouthCurve: 0.95, mouthWide: 0.45, cheekRaise: 0.82,
      lidLower: 0.85, lidUpper: 0.2, teeth: 0.9, browRaise: 0.35,
      headNod: 0.5, ear: 0.6, posture: 0.35, armRaise: 0.3,
    },
    surprised: {
      eyeWide: 1, browRaise: 0.95, mouthOpen: 0.55, mouthWide: -0.7,
      ear: 0.95, lidUpper: -0.35, posture: 0.45, armRaise: 0.4,
    },
    excited: {
      eyeWide: 0.6, browRaise: 0.62, mouthCurve: 0.82, mouthOpen: 0.28,
      teeth: 0.5, cheekRaise: 0.7, ear: 1, posture: 0.55, armRaise: 0.55,
    },
    sad: {
      browTilt: 0.72, mouthCurve: -0.55, lidUpper: 0.32, ear: -0.8,
      posture: -0.6, gazeY: -0.4, cheekRaise: -0.1, armRaise: -0.25,
    },
    /* Added for the ear-drag interaction — the only gap in the existing set.
       `surprised` above already covers the grab; this covers the tug going on
       too long. Mostly brows and pressed lips: put out, not furious. */
    annoyed: {
      browRaise: -0.45, browTilt: -0.55, lidUpper: 0.26, lidLower: 0.34,
      mouthCurve: -0.26, mouthPress: 0.5, ear: -0.65, headTilt: 0.22, posture: -0.12,
    },
    concerned: {
      browTilt: 0.5, browRaise: 0.18, mouthCurve: -0.24, mouthPress: 0.3,
      ear: -0.25, headTilt: 0.2,
    },
    skeptical: {
      browRaiseL: 0.72, browRaiseR: -0.38, lidUpperR: 0.3, mouthCurveL: -0.12,
      mouthCurveR: 0.28, mouthWide: -0.16, headTilt: -0.26, earR: -0.32,
    },
    concentrating: {
      browRaise: -0.42, browTilt: -0.26, lidUpper: 0.24, lidLower: 0.32,
      mouthPress: 0.52, ear: 0.2, posture: 0.2,
    },
    playful: {
      mouthCurveL: 0.9, mouthCurveR: 0.42, lidLowerL: 0.5, browRaiseR: 0.42,
      headTilt: 0.42, earL: 0.8, earR: 0.2, teeth: 0.35, cheekRaise: 0.3,
    },
    embarrassed: {
      gazeX: 0.5, gazeY: -0.35, lidUpper: 0.36, mouthCurve: 0.2, mouthPress: 0.26,
      ear: -0.5, headTilt: -0.3, cheekRaise: 0.32,
    },
  };

  /* Progressive reactions — [delay in seconds, partial spec]. The steps land
     one after another so the character *arrives* at an expression rather than
     snapping into it. */
  var REACTIONS = {
    perk: [[0, { eyeWide: 0.35 }], [0.12, { earL: 0.8, earR: 0.7 }], [0.26, { headTilt: 0.22 }], [0.4, { browRaise: 0.4 }]],
    curious: [[0, { eyeWide: 0.3, gazeY: 0.15 }], [0.15, { earL: 0.8, earR: 0.3 }], [0.3, { headTilt: 0.45 }], [0.45, { browRaiseL: 0.55 }]],
    confuse: [[0, { gazeX: -0.4 }], [0.16, { browRaiseL: 0.5, browRaiseR: -0.2 }], [0.34, { headTilt: -0.4 }], [0.5, { earR: -0.5 }]],
    amuse: [[0, { mouthCurveR: 0.4 }], [0.14, { cheekRaise: 0.42, mouthCurveL: 0.3 }], [0.3, { lidLower: 0.5 }], [0.5, { mouthCurveR: 0.85, teeth: 0.3 }]],
    startle: [[0, { eyeWide: 1, lidUpper: -0.4 }], [0.06, { browRaise: 0.9 }], [0.14, { earL: 0.95, earR: 0.95, mouthOpen: 0.45, mouthWide: -0.5 }], [0.3, { posture: 0.4 }]],
    nod: [[0, { headNod: 0.7 }], [0.22, { headNod: -0.2 }], [0.4, { headNod: 0.25 }]],
    settle: [[0, {}], [0.3, {}]],
    wave: [[0, { armRaiseR: 0.95, mouthCurve: 0.5 }], [0.18, { eyeWide: 0.3, ear: 0.7 }], [0.9, { armRaiseR: 0.4 }]],
  };

  /* Visemes — stylized mouth shapes, not human lips. */
  var VISEMES = {
    rest: { open: 0.0, wide: 0.0, press: 0.12 },
    AA: { open: 0.88, wide: 0.12 },
    E: { open: 0.46, wide: 0.66 },
    I: { open: 0.28, wide: 0.82 },
    O: { open: 0.62, wide: -0.62 },
    U: { open: 0.34, wide: -0.86 },
    M: { open: 0.02, wide: 0.0, press: 0.72 },
    F: { open: 0.16, wide: 0.32, press: 0.42 },
    L: { open: 0.42, wide: 0.18 },
    S: { open: 0.18, wide: 0.56 },
    R: { open: 0.3, wide: -0.26 },
  };
  var CHAR_VISEME = {
    a: "AA", á: "AA", à: "AA", ä: "AA",
    e: "E", é: "E", è: "E",
    i: "I", y: "I", í: "I",
    o: "O", ó: "O", ö: "O",
    u: "U", w: "U", ú: "U", ü: "U",
    m: "M", b: "M", p: "M",
    f: "F", v: "F",
    l: "L",
    s: "S", z: "S", t: "S", d: "S", n: "S", c: "S", k: "S", g: "S", j: "S", x: "S", q: "S", h: "S",
    r: "R",
  };
  function visemeFor(ch) {
    if (!ch) return "rest";
    ch = String(ch).toLowerCase();
    if (ch === " " || ch === "\n" || ch === "\t") return "rest";
    if (".,!?;:\"'()-—".indexOf(ch) >= 0) return "rest";
    return CHAR_VISEME[ch] || "S";
  }
  var VISEME_KEYS = ["AA", "E", "I", "O", "U", "M", "F", "L", "S", "R"];

  // eyelid travel. The eye spans y -0.10 .. 0.22, so an open lid has to sit
  // clear above 0.22 and a closed one has to reach down past 0.06.
  var LID_OPEN_Y = 0.30, LID_SHUT_Y = 0.07, LID_OPEN_S = 0.02, LID_SHUT_S = 0.95;
  var LOW_OPEN_Y = -0.13, LOW_OPEN_S = 0.02;
  var LID_SHOW = 0.03;   // below this the lid is hidden outright, not just thin

  /* expand {browRaise: x} -> {browRaiseL: x, browRaiseR: x} (explicit sides win) */
  var SIDED = ["browRaise", "browTilt", "lidUpper", "lidLower", "mouthCurve", "ear", "armRaise"];
  function expand(spec) {
    var out = {};
    var k;
    for (k in spec) if (SIDED.indexOf(k) < 0) out[k] = spec[k];
    for (var i = 0; i < SIDED.length; i++) {
      var base = SIDED[i];
      if (spec[base] == null) continue;
      if (spec[base + "L"] == null) out[base + "L"] = spec[base];
      if (spec[base + "R"] == null) out[base + "R"] = spec[base];
    }
    return out;
  }
  var EXPANDED = {};
  (function () {
    for (var k in EMOTIONS) EXPANDED[k] = expand(EMOTIONS[k]);
  })();

  function createAvatar() {
    var THREE, container, renderer, scene, camera;
    var raf = null, ready = false, ro = null;
    var root, head, body, earL, earR, eyeL, eyeR, lidL, lidR, lidLoL, lidLoR;
    var armL, armR, legL, legR, chestMark;
    var browL, browR, nose, cheekL, cheekR, glow, mouthMesh, mouthGeo, teeth;
    var reduce =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* eased random-waypoint channel — irregular targets, never a visible loop */
    function chan(seed) {
      return { v: 0, tgt: 0, tn: Math.random() * (seed || 2) };
    }
    function wander(ch, dt, minI, maxI, ease) {
      ch.tn -= dt;
      if (ch.tn <= 0) {
        ch.tgt = Math.random() * 2 - 1;
        ch.tn = minI + Math.random() * (maxI - minI);
      }
      ch.v += (ch.tgt - ch.v) * Math.min(1, dt * ease);
      return ch.v;
    }

    // P = where the face is now, T = where it is heading
    var P = {}, T = {};
    (function () {
      for (var i = 0; i < PARAMS.length; i++) { P[PARAMS[i]] = 0; T[PARAMS[i]] = 0; }
    })();

    var s = {
      speaking: false, thinking: false, listening: false,
      t: 0, last: 0,

      // emotion layers
      baseEmotion: "calm",
      mood: null, moodAmt: 0, moodHold: 0,
      overlay: {}, overlayDecay: 0,
      queue: [],                 // pending progressive reaction steps

      // speech
      amp: 0, ampAt: 0, mouthMag: 0,
      viseme: "rest", visemeAt: 0, visTarget: { open: 0, wide: 0, press: 0.12 },
      phQueue: [], phTimer: 0,
      visCur: { open: 0, wide: 0, press: 0.12 },
      synthTimer: 0, lastViseme: "rest",

      // ear drag: target (T) vs eased (no suffix) vs spring velocity (V).
      // The velocity is what produces the recoil — on release the target
      // snaps to 0 but the momentum carries the ear past it and back.
      pull: false, pullSide: 1,
      pullTX: 0, pullTY: 0, pullTA: 0,
      pullX: 0, pullY: 0, pullA: 0,
      pullVX: 0, pullVY: 0, pullVA: 0,

      // micro-behaviour
      blinkTimer: 1.2, blinking: false, blinkPhase: 0, blinkSpeed: 11, blinkHold: 0,
      doubleBlink: false,
      sacTimer: 0.8, sacX: 0, sacY: 0, fixX: 0, fixY: 0,
      // where the user's cursor is, and how hard he is tracking it
      ptrX: 0, ptrY: 0, ptrSeen: -99, ptrIn: false, follow: 0, ptrReactCd: 0,
      stillUntil: 0, restlessUntil: 0,
      flickTimer: 3, flickL: 0, flickR: 0,
      noseTimer: 4,
      nodImpulse: 0, emphCd: 0,
      idleShiftTimer: 5, moodDrift: 8 + Math.random() * 10, wave: 0,

      // slow drift channels
      hYaw: chan(), hPitch: chan(), hRoll: chan(),
      earLw: chan(), earRw: chan(),
      breath: Math.random() * 6,
      asymL: Math.random() * 0.06 - 0.03,
      asymR: Math.random() * 0.06 - 0.03,
      lagL: 0.85 + Math.random() * 0.3,   // per-side timing jitter
      lagR: 0.85 + Math.random() * 0.3,

      // camera
      tPos: FRAMES.default.pos.slice(),
      tLook: FRAMES.default.look.slice(),
      curLook: FRAMES.default.look.slice(),
    };

    /* ─────────── geometry ─────────── */
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
      var m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), material);
      m.scale.set(sx, sy, sz);
      return m;
    }

    // parametric mouth: two curves (upper lip edge, lower lip edge) stitched
    // into a filled dark shape. Corners move independently for asymmetric
    // smiles; the centre opens for vowels. 13 columns, rebuilt each frame.
    var MN = 13;
    function buildMouthGeometry() {
      var pos = new Float32Array(MN * 2 * 3);
      var idx = [];
      for (var i = 0; i < MN - 1; i++) {
        var u = i, u2 = i + 1, l = MN + i, l2 = MN + i + 1;
        idx.push(u, l, l2, u, l2, u2);
      }
      mouthGeo = new THREE.BufferGeometry();
      mouthGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      mouthGeo.setIndex(idx);
      return mouthGeo;
    }
    function updateMouthGeometry() {
      var a = mouthGeo.attributes.position.array;
      var open = Math.max(0, P.mouthOpen);
      var wide = P.mouthWide;
      var press = P.mouthPress;
      var cl = P.mouthCurveL, cr = P.mouthCurveR;

      var halfW = 0.20 * (1 + wide * 0.34) * (1 - press * 0.12);
      var lipGap = 0.030 + open * 0.235;         // visible even at rest
      var upLift = open * 0.055;
      for (var i = 0; i < MN; i++) {
        var f = i / (MN - 1);              // 0..1
        var t = f * 2 - 1;                 // -1..1
        var centre = 1 - t * t;            // 1 at middle, 0 at corners
        var round = Math.pow(centre, 0.62);// flatter bottom -> rounded, not a V
        var cornerW = t * t;               // inverse
        var curve = (t < 0 ? cl : cr) * cornerW * 0.155;
        var x = t * halfW;
        var yUp = curve + upLift * centre + press * 0.008;
        var yLo = curve * 0.55 - lipGap * round - press * 0.006;
        var z = centre * 0.035;            // wrap onto the muzzle
        var o = i * 3;
        a[o] = x; a[o + 1] = yUp; a[o + 2] = z;
        var p2 = (MN + i) * 3;
        a[p2] = x; a[p2 + 1] = yLo; a[p2 + 2] = z;
      }
      mouthGeo.attributes.position.needsUpdate = true;
      mouthGeo.computeBoundingSphere();
    }

    function buildBunny() {
      root = new THREE.Group();

      var furMat = mat(COL.fur, { rough: 0.8 });
      var shadeMat = mat(COL.furShade, { rough: 0.85 });
      var earInnerMat = mat(COL.innerEar, { emissive: COL.innerEar, emi: 0.35, rough: 0.5 });

      /* ---- body ----
         Proportion is the whole point: the head ball spans y -0.45..1.45
         (1.90 units) and everything below it gets 1.05, so the head is ~64% of
         head+body height — oversized on purpose, per the reference silhouette.
         The body is deliberately narrower than the head (half-width 0.56 vs
         1.00) so it never competes with the face. */
      body = new THREE.Group();

      // compact, slightly chubby torso. Its top overlaps the head's underside,
      // so the join reads as soft with no visible neck.
      /* One torso, not a pile of overlapping spheres — stacking chest/belly
         blobs of similar size read as lumpy rather than soft. A single egg
         whose top tucks under the head gives the neckless join on its own.
         Half-width 0.55 against the head's 1.00: the body is a supporting
         shape and never competes with the face. */
      var torso = ellipsoid(0.55, 1, 0.92, 0.86, furMat);
      torso.position.set(0, -0.78, 0);
      body.add(torso);

      /* Cyan power mark on the chest. The torso is an ellipsoid, so its front
         surface at height y is z = halfDepth * sqrt(1 - (dy/halfHeight)^2);
         at y -0.72 that is 0.464, and the mark has to sit just proud of it or
         it renders buried inside the body. */
      var markMat = mat(COL.glow, { emissive: COL.glow, emi: 0.85, rough: 0.4 });
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.105, 0.018, 8, 26, Math.PI * 1.55), markMat);
      ring.rotation.z = Math.PI * 0.725;
      var stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.095, 10), markMat);
      stem.position.y = 0.055;
      chestMark = new THREE.Group();
      chestMark.add(ring, stem);
      chestMark.position.set(0, -0.70, 0.474);
      body.add(chestMark);

      // short mitten arms, pivoting from the shoulder so they can gesture.
      // Placed just outside the torso silhouette (0.62 vs half-width 0.55) so
      // they read as limbs instead of disappearing into the body.
      function makeArm(side) {
        var g = new THREE.Group();
        var upper = ellipsoid(0.135, 1, 1.45, 1, furMat);
        upper.position.y = -0.18;
        var hand = ellipsoid(0.155, 1, 0.95, 0.9, furMat);
        hand.position.y = -0.40;
        g.add(upper, hand);
        g.position.set(side * 0.59, -0.70, 0.08);
        g.rotation.z = side * -0.1;
        g.userData.side = side;
        return g;
      }
      armL = makeArm(-1);
      armR = makeArm(1);
      body.add(armL, armR);

      // stubby legs, wide soft feet, set close together for a stable base
      function makeLeg(side) {
        var g = new THREE.Group();
        var leg = ellipsoid(0.17, 1, 0.62, 1, furMat);
        leg.position.y = -0.05;
        var foot = ellipsoid(0.215, 1.02, 0.58, 1.42, furMat);
        foot.position.set(side * 0.004, -0.185, 0.105);
        g.add(leg, foot);
        g.position.set(side * 0.225, -1.27, 0);
        g.userData.side = side;
        return g;
      }
      legL = makeLeg(-1);
      legR = makeLeg(1);
      body.add(legL, legR);

      // small round tail, only really visible from behind
      var tail = ellipsoid(0.155, 1, 0.92, 0.8, furMat);
      tail.position.set(0, -0.88, -0.45);
      body.add(tail);

      root.add(body);

      head = new THREE.Group();
      head.position.set(0, 0.5, 0);
      root.add(head);

      head.add(ellipsoid(0.95, 1.05, 1.0, 0.98, furMat)); // skull

      // muzzle cheeks — these rise and puff on smiles and laughter
      cheekL = ellipsoid(0.34, 1, 0.8, 1, furMat);
      cheekL.position.set(-0.32, -0.28, 0.7);
      cheekR = cheekL.clone();
      cheekR.position.x = 0.32;
      head.add(cheekL, cheekR);

      function makeEar(side) {
        var ear = new THREE.Group();
        var outer = ellipsoid(0.34, 0.6, 1.45, 0.32, furMat);
        var inner = ellipsoid(0.34, 0.38, 1.22, 0.3, earInnerMat);
        inner.position.z = 0.09;
        outer.position.y = 0.45;
        inner.position.y = 0.45;
        ear.add(outer, inner);
        ear.position.set(side * 0.42, 0.9, -0.05);
        ear.rotation.z = side * -0.16;
        ear.rotation.x = -0.12;
        return ear;
      }
      earL = makeEar(-1);
      earR = makeEar(1);
      head.add(earL, earR);

      // eyes — large, dark, glossy. Two glints so they read as wet, and so
      // gaze direction is legible on an otherwise featureless dark ball.
      var eyeMat = mat(COL.eye, { rough: 0.22, metal: 0.12 });
      var glintMat = new THREE.MeshBasicMaterial({ color: COL.glint });
      function makeEye(side) {
        var g = new THREE.Group();
        g.add(ellipsoid(0.19, 1, 0.86, 1, eyeMat));
        var glint = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), glintMat);
        glint.position.set(side * 0.05, 0.06, 0.17);
        var glint2 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), glintMat);
        glint2.position.set(side * -0.06, -0.05, 0.16);
        g.add(glint, glint2);
        g.position.set(side * 0.4, 0.06, 0.82);
        g.userData.glints = [glint, glint2];
        return g;
      }
      eyeL = makeEye(-1);
      eyeR = makeEye(1);
      head.add(eyeL, eyeR);

      // upper lids — travel down over the eye to close properly (the old rig
      // only ever covered the top sliver, so it never truly blinked)
      function makeLid(side) {
        var lid = ellipsoid(0.21, 1.05, 1, 1.05, furMat);
        lid.position.set(side * 0.4, LID_OPEN_Y, 0.83);
        lid.scale.y = LID_OPEN_S;   // a thin crease, not a hood
        return lid;
      }
      lidL = makeLid(-1);
      lidR = makeLid(1);
      // lower lids — raising these is what makes a smile reach the eyes
      function makeLowerLid(side) {
        var lid = ellipsoid(0.2, 1.02, 1, 1.02, furMat);
        lid.position.set(side * 0.4, LOW_OPEN_Y, 0.83);
        lid.scale.y = LOW_OPEN_S;
        return lid;
      }
      lidLoL = makeLowerLid(-1);
      lidLoR = makeLowerLid(1);
      head.add(lidL, lidR, lidLoL, lidLoR);

      // brows — the thin grey lines above the eyes, now independently posable
      var browMat = mat(COL.brow, { rough: 0.9 });
      function makeBrow(side) {
        var b = ellipsoid(0.17, 1, 0.16, 0.5, browMat);
        b.position.set(side * 0.4, 0.44, 0.84);
        return b;
      }
      browL = makeBrow(-1);
      browR = makeBrow(1);
      head.add(browL, browR);

      nose = ellipsoid(0.1, 1.2, 0.9, 1, mat(COL.nose, { emissive: COL.nose, emi: 0.25 }));
      nose.position.set(0, -0.18, 1.0);
      head.add(nose);

      // mouth — parametric dark aperture on the muzzle
      var mouthMat = new THREE.MeshBasicMaterial({
        color: COL.mouth, side: THREE.DoubleSide,
      });
      mouthMesh = new THREE.Mesh(buildMouthGeometry(), mouthMat);
      mouthMesh.position.set(0, -0.42, 0.95);
      head.add(mouthMesh);

      // two small incisors, hidden unless the bunny really smiles or laughs
      teeth = new THREE.Group();
      var toothMat = mat(COL.tooth, { rough: 0.35 });
      function tooth(side) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.062, 0.03), toothMat);
        m.position.set(side * 0.031, 0, 0);
        return m;
      }
      teeth.add(tooth(-1), tooth(1));
      teeth.position.set(0, -0.45, 1.0);   // in front of the mouth's z-bulge
      teeth.visible = false;
      head.add(teeth);

      var glowMat = new THREE.MeshBasicMaterial({
        color: COL.glow, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      glow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), glowMat);
      glow.position.set(0, 0.4, -1.1);
      root.add(glow);

      scene.add(root);
      updateMouthGeometry();
    }

    function buildScene() {
      scene = new THREE.Scene();
      var w = container.clientWidth || 360;
      var h = container.clientHeight || 220;
      camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
      camera.position.set(s.tPos[0], s.tPos[1], s.tPos[2]);
      s.curLook = s.tLook.slice();
      camera.lookAt(s.curLook[0], s.curLook[1], s.curLook[2]);

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

    function onPointer(e) {
      if (!container) return;
      var r = container.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      var ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      // allow a little past the edges so he still leans toward a cursor just
      // outside the stage instead of clamping dead at the border
      s.ptrX = Math.max(-1.5, Math.min(1.5, nx));
      s.ptrY = Math.max(-1.5, Math.min(1.5, ny));
      var inside = nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
      if (inside && !s.ptrIn && s.ptrReactCd <= 0) {
        react("perk");             // he notices you arriving
        s.ptrReactCd = 2.5;
      }
      s.ptrIn = inside;
      s.ptrSeen = s.t;
    }

    function resize() {
      if (!renderer || !container) return;
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    /* ─────────── emotion blending ─────────── */
    function baseFor() {
      if (s.speaking) return "interested";
      if (s.thinking) return "thinking";
      if (s.listening) return "attentive";
      return "calm";
    }
    function composeTarget(dt) {
      var i, k;
      for (i = 0; i < PARAMS.length; i++) T[PARAMS[i]] = 0;

      // layer 1 — conversation state
      var base = EXPANDED[baseFor()] || {};
      for (k in base) if (T[k] != null) T[k] += base[k];

      // layer 2 — mood inferred from what is being said, decaying
      if (s.mood && s.moodAmt > 0.001) {
        var m = EXPANDED[s.mood] || {};
        s.moodHold -= dt;
        if (s.moodHold <= 0) s.moodAmt -= dt * 0.32;   // fades, never cuts
        if (s.moodAmt <= 0) { s.moodAmt = 0; s.mood = null; }
        for (k in m) if (T[k] != null) T[k] += m[k] * s.moodAmt;
      }

      // layer 3 — short-lived reaction overlay
      if (s.overlayDecay > 0) {
        s.overlayDecay -= dt;
        var f = Math.min(1, s.overlayDecay / 0.7);
        for (k in s.overlay) if (T[k] != null) T[k] += s.overlay[k] * f;
        if (s.overlayDecay <= 0) s.overlay = {};
      }

      // pending progressive reaction steps
      for (i = s.queue.length - 1; i >= 0; i--) {
        s.queue[i].t -= dt;
        if (s.queue[i].t <= 0) {
          var spec = expand(s.queue[i].spec);
          for (k in spec) s.overlay[k] = spec[k];
          s.overlayDecay = Math.max(s.overlayDecay, 1.5);
          s.queue.splice(i, 1);
        }
      }

      // clamp, then add a permanent whisper of asymmetry
      for (i = 0; i < PARAMS.length; i++) {
        k = PARAMS[i];
        T[k] = Math.max(-1.4, Math.min(1.4, T[k]));
      }
      T.browRaiseL += s.asymL * 1.4;
      T.browRaiseR += s.asymR * 1.4;
      T.mouthCurveL += s.asymL;
      T.mouthCurveR += s.asymR * 0.8;
      T.earL += s.asymL * 0.8;
      T.earR += s.asymR * 0.8;
    }
    function easeParams(dt) {
      for (var i = 0; i < PARAMS.length; i++) {
        var k = PARAMS[i];
        var sp = SPEED[k] || 6;
        // per-side timing jitter so left and right never arrive together
        if (k.charAt(k.length - 1) === "L") sp *= s.lagL;
        else if (k.charAt(k.length - 1) === "R") sp *= s.lagR;
        P[k] += (T[k] - P[k]) * Math.min(1, dt * sp * (reduce ? 0.6 : 1));
      }
    }

    /* ─────────── speech ─────────── */
    function currentVisemeTarget(dt) {
      // a whole word was handed over (browser TTS boundary) — walk its
      // characters so the mouth actually articulates through it
      if (s.phQueue.length) {
        s.phTimer -= dt;
        if (s.phTimer <= 0) {
          s.viseme = visemeFor(s.phQueue.shift());
          s.visemeAt = performance.now();
          s.phTimer = 0.062;
        }
      }
      var fresh = performance.now() - s.visemeAt < 220;
      if (s.speaking) {
        if (!fresh) {
          // no per-character alignment (browser TTS): pick plausible visemes at
          // a syllable rate instead of flapping the jaw with the volume
          s.synthTimer -= dt;
          if (s.synthTimer <= 0) {
            var next;
            do { next = VISEME_KEYS[(Math.random() * VISEME_KEYS.length) | 0]; }
            while (next === s.lastViseme);
            s.lastViseme = next;
            s.viseme = next;
            s.synthTimer = 0.075 + Math.random() * 0.085;
          }
        }
      } else if (!fresh) {
        s.viseme = "rest";
      }
      var v = VISEMES[s.viseme] || VISEMES.rest;
      s.visTarget.open = v.open || 0;
      s.visTarget.wide = v.wide || 0;
      s.visTarget.press = v.press || 0;
    }

    /* ─────────── micro-behaviour ─────────── */
    function blinks(dt) {
      if (s.noBlink) return 0;
      s.blinkTimer -= dt;
      if (!s.blinking && s.blinkTimer <= 0) {
        s.blinking = true;
        s.blinkPhase = 0;
        var r = Math.random();
        // long slow blink when calm, quick flick when alert
        s.blinkSpeed = r < 0.16 ? 6 : r < 0.35 ? 15 : 11;
        s.blinkHold = r < 0.16 ? 0.12 : 0;
      }
      var close = 0;
      if (s.blinking) {
        s.blinkPhase += dt * s.blinkSpeed;
        var b = s.blinkPhase < 1 ? s.blinkPhase : 2 - s.blinkPhase;
        close = Math.max(0, Math.min(1, b));
        if (s.blinkPhase >= 2) {
          s.blinking = false;
          if (!s.doubleBlink && Math.random() < 0.17) {
            s.doubleBlink = true;
            s.blinkTimer = 0.15;
          } else {
            s.doubleBlink = false;
            s.blinkTimer = 1.8 + Math.random() * 4.4 - (s.listening ? 0.5 : 0);
          }
        }
      }
      return close;
    }
    function saccades(dt) {
      // real eyes jump and fixate; they do not drift smoothly forever
      s.sacTimer -= dt;
      if (s.sacTimer <= 0) {
        var big = Math.random() < (s.thinking ? 0.5 : 0.18);
        s.fixX = (Math.random() * 2 - 1) * (big ? 0.9 : 0.28);
        s.fixY = (Math.random() * 2 - 1) * (big ? 0.5 : 0.2);
        s.sacTimer = big ? 0.5 + Math.random() * 1.6 : 0.9 + Math.random() * 2.8;
        if (Math.random() < 0.25) s.sacTimer *= 2.2;   // long fixation
      }
      // fast toward the new fixation, then hold
      s.sacX += (s.fixX - s.sacX) * Math.min(1, dt * 22);
      s.sacY += (s.fixY - s.sacY) * Math.min(1, dt * 22);
    }

    /* ─────────── per-frame ─────────── */
    function update(dt) {
      s.t += dt;
      var amp = reduce ? 0.3 : 1;

      var ck = Math.min(1, dt * 4);
      camera.position.x += (s.tPos[0] - camera.position.x) * ck;
      camera.position.y += (s.tPos[1] - camera.position.y) * ck;
      camera.position.z += (s.tPos[2] - camera.position.z) * ck;
      s.curLook[0] += (s.tLook[0] - s.curLook[0]) * ck;
      s.curLook[1] += (s.tLook[1] - s.curLook[1]) * ck;
      s.curLook[2] += (s.tLook[2] - s.curLook[2]) * ck;
      camera.lookAt(s.curLook[0], s.curLook[1], s.curLook[2]);

      composeTarget(dt);

      // ---- speech drives the mouth channels on top of the emotion ----
      currentVisemeTarget(dt);
      var ampFresh = performance.now() - s.ampAt < 180;
      var magT = s.speaking ? (ampFresh ? Math.min(1, s.amp * 1.15) : 0.72) : 0;
      s.mouthMag += (magT - s.mouthMag) * Math.min(1, dt * (magT > s.mouthMag ? 22 : 11));
      var vk = Math.min(1, dt * 20);
      s.visCur.open += (s.visTarget.open - s.visCur.open) * vk;
      s.visCur.wide += (s.visTarget.wide - s.visCur.wide) * vk;
      s.visCur.press += (s.visTarget.press - s.visCur.press) * vk;
      T.mouthOpen += s.visCur.open * s.mouthMag;
      T.mouthWide += s.visCur.wide * (0.4 + 0.6 * s.mouthMag);
      T.mouthPress += s.visCur.press * (1 - s.mouthMag * 0.6);

      // ---- ambient mood: the character has a disposition even when silent,
      //      which is what makes the quieter expressions reachable at all ----
      if (!s.speaking && !s.thinking) {
        s.moodDrift -= dt;
        if (s.moodDrift <= 0) {
          var pool = ["calm", "calm", "thoughtful", "playful", "curious",
                      "interested", "concentrating", "amused"];
          var pick2 = pool[(Math.random() * pool.length) | 0];
          if (!s.mood || s.moodAmt < 0.2) {
            s.mood = pick2;
            s.moodAmt = 0.3 + Math.random() * 0.28;   // low key, never a mug
            s.moodHold = 4 + Math.random() * 6;
          }
          s.moodDrift = 12 + Math.random() * 20;
        }
      }

      // ---- idle: alternate genuine stillness with small reactions ----
      if (!s.speaking) {
        s.idleShiftTimer -= dt;
        if (s.idleShiftTimer <= 0) {
          if (s.t < s.stillUntil) {
            s.idleShiftTimer = 1.5;
          } else if (Math.random() < 0.42) {
            s.stillUntil = s.t + 2.5 + Math.random() * 4;   // hold near-perfect stillness
            s.idleShiftTimer = 3 + Math.random() * 3;
          } else {
            var pick = ["perk", "curious", "nod"][(Math.random() * 3) | 0];
            if (Math.random() < 0.5) react(pick);
            s.idleShiftTimer = 4 + Math.random() * 7;
          }
        }
      }
      var still = s.t < s.stillUntil ? 0.25 : 1;

      easeParams(dt);

      // ---- blink + gaze, layered over the eased parameters ----
      var close = blinks(dt);
      saccades(dt);

      // ---------- apply to meshes ---------- //
      var act = (s.speaking ? 1 : s.listening ? 0.55 : 0.8) * amp * still;

      // brows
      if (browL) {
        browL.position.y = 0.44 + P.browRaiseL * 0.085;
        browL.rotation.z = -P.browTiltL * 0.34 + P.browRaiseL * 0.05;
        browL.scale.y = 0.16 * (1 + Math.abs(P.browRaiseL) * 0.18);
      }
      if (browR) {
        browR.position.y = 0.44 + P.browRaiseR * 0.085;
        browR.rotation.z = P.browTiltR * 0.34 - P.browRaiseR * 0.05;
        browR.scale.y = 0.16 * (1 + Math.abs(P.browRaiseR) * 0.18);
      }

      /* Cursor tracking. He follows hard while the pointer is actually over
         him, softer when it is elsewhere on the page, and not at all while he
         is thinking (he looks away then, by design). The weight itself eases,
         so attention arrives and fades rather than snapping on. */
      s.ptrReactCd = Math.max(0, s.ptrReactCd - dt);
      var wantFollow = s.thinking ? 0
        : s.t - s.ptrSeen < 5 ? (s.ptrIn ? 1 : 0.45) : 0;
      s.follow += (wantFollow - s.follow) * Math.min(1, dt * 3.5);
      var fx = s.ptrX * s.follow;
      var fy = s.ptrY * s.follow;

      // eyes lead, and travel furthest
      var gx = (P.gazeX + s.sacX * 0.55 + fx * 1.15) * 0.055;
      var gy = (P.gazeY + s.sacY * 0.5 + fy * 1.1) * 0.04;
      var wide = 1 + P.eyeWide * 0.1;
      if (eyeL) {
        eyeL.position.x = -0.4 + gx;
        eyeL.position.y = 0.06 + gy;
        eyeL.scale.set(wide, wide, 1);
      }
      if (eyeR) {
        eyeR.position.x = 0.4 + gx;
        eyeR.position.y = 0.06 + gy;
        eyeR.scale.set(wide, wide, 1);
      }

      // upper lids travel down to actually cover the eye
      function lidPose(lid, upper, eyeX) {
        if (!lid) return;
        var c = Math.max(close, Math.max(0, upper));
        lid.visible = c > LID_SHOW;      // open eye = no lid mesh at all
        if (!lid.visible) return;
        lid.position.x = eyeX;
        lid.position.y = LID_OPEN_Y + gy * 0.6 - c * (LID_OPEN_Y - LID_SHUT_Y)
                         + Math.min(0, upper) * 0.05;
        lid.scale.y = LID_OPEN_S + c * (LID_SHUT_S - LID_OPEN_S);
      }
      lidPose(lidL, P.lidUpperL, -0.4 + gx * 0.5);
      lidPose(lidR, P.lidUpperR, 0.4 + gx * 0.5);
      // lower lids rise on squint / genuine smile, pushed by the cheeks
      function lowLidPose(lid, v, eyeX) {
        if (!lid) return;
        var r = Math.max(0, v) + P.cheekRaise * 0.35;
        lid.visible = r > LID_SHOW;
        if (!lid.visible) return;
        lid.position.x = eyeX;
        lid.position.y = LOW_OPEN_Y + gy * 0.4 + r * 0.14;
        lid.scale.y = LOW_OPEN_S + r * 0.22;
      }
      lowLidPose(lidLoL, P.lidLowerL, -0.4 + gx * 0.5);
      lowLidPose(lidLoR, P.lidLowerR, 0.4 + gx * 0.5);

      // muzzle: cheeks rise and puff
      var cr = P.cheekRaise;
      if (cheekL) {
        cheekL.position.set(-0.32 - cr * 0.022, -0.285 + cr * 0.032, 0.7);
        cheekL.scale.set(1 + cr * 0.085, 0.8 + cr * 0.07, 1 + cr * 0.02);
      }
      if (cheekR) {
        cheekR.position.set(0.32 + cr * 0.022, -0.285 + cr * 0.032, 0.7);
        cheekR.scale.set(1 + cr * 0.085, 0.8 + cr * 0.07, 1 + cr * 0.02);
      }

      // mouth + teeth
      updateMouthGeometry();
      if (mouthMesh) mouthMesh.position.y = -0.42 - P.mouthOpen * 0.012 + cr * 0.02;
      if (teeth) {
        var gate = Math.max(0, Math.min(1, (P.mouthOpen - 0.14) / 0.22));
        var show = Math.max(0, P.teeth) * gate * gate * (3 - 2 * gate);
        teeth.visible = show > 0.05;
        if (teeth.visible) {
          teeth.scale.set(1, Math.max(0.25, show), 1);
          teeth.position.y = -0.425 - P.mouthOpen * 0.02 + cr * 0.02;
        }
      }

      // nose twitch
      s.noseTimer -= dt;
      if (s.noseTimer <= 0) { T.noseTwitch = 1; s.noseTimer = 3 + Math.random() * 7; }
      P.noseTwitch *= Math.exp(-dt * 6);
      if (nose) nose.scale.set(1.2 + P.noseTwitch * 0.1, 0.9 - P.noseTwitch * 0.06, 1);

      // ears: emotion angle + independent drift + occasional flick
      s.flickL = Math.max(0, s.flickL - dt * 3.2);
      s.flickR = Math.max(0, s.flickR - dt * 3.2);
      s.flickTimer -= dt;
      if (s.flickTimer <= 0) {
        if (Math.random() < 0.5) s.flickL = 0.7 + Math.random() * 0.3;
        else s.flickR = 0.7 + Math.random() * 0.3;
        s.flickTimer = 2.5 + Math.random() * 5.5;
      }
      var ewL = wander(s.earLw, dt, 1.8, 4.5, 1.4) * 0.045 * amp * still;
      var ewR = wander(s.earRw, dt, 1.7, 4.3, 1.4) * 0.045 * amp * still;
      // ears prick up while he is being looked at, and swing toward the cursor
      var earFollow = s.follow * (s.ptrIn ? 0.14 : 0.05);
      if (earL) {
        earL.rotation.z = -0.16 + P.earL * 0.07 + ewL - s.flickL * 0.18 - fx * 0.05;
        earL.rotation.x = -0.12 + P.earL * 0.16 + s.flickL * 0.05 + earFollow;
      }
      if (earR) {
        earR.rotation.z = 0.16 - P.earR * 0.07 + ewR + s.flickR * 0.18 - fx * 0.05;
        earR.rotation.x = -0.12 + P.earR * 0.16 + s.flickR * 0.05 + earFollow;
      }

      // emphasis nod on speech peaks (throttled so it is not per-word)
      s.emphCd -= dt;
      if (s.speaking && s.mouthMag > 0.55 && s.emphCd <= 0 && Math.random() < 0.5) {
        s.nodImpulse = 0.4 + Math.random() * 0.4;
        s.emphCd = 0.7 + Math.random() * 1.1;
      }
      s.nodImpulse *= Math.exp(-dt * 5);

      // head: emotion pose + layered drift + breathing
      s.breath += dt;
      var br = Math.sin(s.breath * 1.15);
      var yaw = wander(s.hYaw, dt, 1.6, 4.2, 1.5) * 0.055 * act;
      var pit = wander(s.hPitch, dt, 1.9, 4.8, 1.5) * 0.032 * act;
      var rol = wander(s.hRoll, dt, 2.4, 5.6, 1.3) * 0.02 * act;
      if (head) {
        // the head turns after the eyes, and less far — that lag is most of
        // what makes it read as attention rather than a mechanical lookAt
        head.rotation.y = yaw + P.gazeX * 0.05 + fx * 0.15;
        head.rotation.x = pit - P.headNod * 0.09 - s.nodImpulse * 0.06 - P.posture * 0.03 - fy * 0.09;
        head.rotation.z = rol + P.headTilt * 0.16 + fx * 0.03;
        head.position.y = 0.5 + br * 0.02 * amp + P.posture * 0.03;
        head.position.x = fx * 0.05;
      }
      if (body) {
        // the body comes last and barely moves — a whole-character lean
        body.rotation.z = P.headTilt * 0.03 - fx * 0.02;
        body.rotation.y = fx * 0.06;
        body.position.y = P.posture * 0.02 + br * 0.008 * amp;
        body.position.x = fx * 0.03;
      }
      // arms: hang from the shoulder, sway a little with the breath, lift on
      // the bigger emotions, and swing while waving
      s.wave = Math.max(0, s.wave - dt * 0.7);
      var swing = s.wave > 0 ? Math.sin(s.t * 13) * s.wave * 0.55 : 0;
      if (armL) {
        armL.rotation.z = 0.08 - P.armRaiseL * 0.55 + br * 0.012 * amp;
        armL.rotation.x = -P.armRaiseL * 0.18 + br * 0.02 * amp;
      }
      if (armR) {
        armR.rotation.z = -0.08 + P.armRaiseR * 0.55 - swing + br * 0.012 * amp;
        armR.rotation.x = -P.armRaiseR * 0.18 - br * 0.02 * amp;
      }
      // legs stay planted; they only take the posture shift and the breath
      if (legL) legL.rotation.x = br * 0.006 * amp - P.posture * 0.02;
      if (legR) legR.rotation.x = -br * 0.006 * amp - P.posture * 0.02;
      if (chestMark) {
        chestMark.children[0].material.emissiveIntensity =
          0.6 + (s.speaking ? 0.5 * s.mouthMag : 0) + Math.sin(s.t * 1.9) * 0.12;
      }
      applyPull(dt);
      if (root) root.scale.setScalar(1 + br * 0.005 * amp);
      if (glow) {
        glow.material.opacity =
          0.07 + (s.speaking ? 0.05 * (0.4 + s.mouthMag) : s.thinking ? 0.05 : 0) +
          Math.sin(s.t * 1.7) * 0.015;
      }
    }

    /* ─────────── ear pull ───────────
       Layered on top of the poses already written this frame, so it composes
       with the emotion blend rather than fighting it. Underdamped on release
       (lower k, much lower c) so the ear springs past neutral and settles. */
    function applyPull(dt) {
      var live = s.pull;
      var tx = live ? s.pullTX : 0, ty = live ? s.pullTY : 0, ta = live ? s.pullTA : 0;
      var k = live ? 300 : 165, c = live ? 30 : 11;
      s.pullVX += (tx - s.pullX) * k * dt; s.pullVX *= Math.exp(-c * dt); s.pullX += s.pullVX * dt;
      s.pullVY += (ty - s.pullY) * k * dt; s.pullVY *= Math.exp(-c * dt); s.pullY += s.pullVY * dt;
      s.pullVA += (ta - s.pullA) * k * dt; s.pullVA *= Math.exp(-c * dt); s.pullA += s.pullVA * dt;

      var px = s.pullX, py = s.pullY;
      var mag = Math.min(1.4, Math.hypot(px, py));

      if (earL) earL.scale.y = 1;
      if (earR) earR.scale.y = 1;
      if (mag < 0.002 && Math.abs(s.pullA) < 0.002) {
        if (root) { root.position.x = 0; root.position.y = 0; }
        return;
      }

      var grabbed = s.pullSide < 0 ? earL : earR;
      var other   = s.pullSide < 0 ? earR : earL;
      // the held ear swings toward the cursor and stretches along the pull;
      // capped hard so it never turns into taffy
      if (grabbed) {
        grabbed.rotation.z += -px * 1.15;
        grabbed.rotation.x += py * 0.95;
        grabbed.scale.y = 1 + Math.min(0.32, mag * 0.3);
      }
      if (other) {                    // the free ear only sympathises
        other.rotation.z += -px * 0.28;
        other.rotation.x += py * 0.2;
      }
      if (head) {
        head.rotation.z += -px * 0.3;
        head.rotation.x += py * 0.22;
        head.position.x += px * 0.13;
        head.position.y += py * 0.09;
      }
      if (body) {                     // the body follows late and least
        body.rotation.z += -px * 0.1;
        body.position.x += px * 0.05;
        body.position.y += py * 0.03;
      }
      if (root) {
        root.position.x = px * 0.1;
        root.position.y = py * 0.06;
      }
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      var dt = s.last ? (now - s.last) / 1000 : 0.016;
      s.last = now;
      if (dt > 0.1) dt = 0.1;
      update(dt);
      renderer.render(scene, camera);
    }

    /* ─────────── public API ─────────── */
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
          window.addEventListener("pointermove", onPointer, { passive: true });
          ready = true;
          resume();
          return true;
        })
        .catch(function (err) {
          console.error("[assistant-avatar] mount failed:", err && err.message ? err.message : err);
          ready = false;
          return false;
        });
    }
    function setSpeaking(v) {
      v = !!v;
      if (v === s.speaking) return;
      s.speaking = v;
      if (!v) { s.viseme = "rest"; s.mouthMag = 0; s.phQueue.length = 0; }
    }
    function setThinking(v) {
      v = !!v;
      if (v === s.thinking) return;
      s.thinking = v;
      if (v) react("curious");
    }
    function setListening(v) {
      v = !!v;
      if (v === s.listening) return;
      s.listening = v;
      if (v) react("perk");
    }
    function pulse() {
      if (!s.speaking) return;
      s.nodImpulse = Math.max(s.nodImpulse, 0.35);
      if (Math.random() < 0.22) {
        if (Math.random() < 0.5) s.flickL = 0.7; else s.flickR = 0.7;
      }
      if (Math.random() < 0.12) T.browRaiseL += 0.3;
    }
    function setMouth(v) {
      s.amp = Math.max(0, Math.min(1.2, v || 0));
      s.ampAt = performance.now();
    }
    function setPhoneme(txt) {
      if (txt == null) return;
      txt = String(txt);
      if (txt.length > 1) {
        // a word: queue its characters, consumed at a natural articulation rate
        s.phQueue = txt.slice(0, 22).split("");
        s.phTimer = 0;
        s.visemeAt = performance.now();
        return;
      }
      s.phQueue.length = 0;
      var v = visemeFor(txt);
      // a brief closure between words reads better than snapping wide open
      s.viseme = v === "rest" && s.viseme !== "rest" ? "M" : v;
      s.visemeAt = performance.now();
    }
    /* The floor the blend falls back to when no mood or reaction is active.
       Docked in the corner the bunny should rest on something friendlier than
       "calm" (mouthCurve 0.16, ears down) without wearing a fixed grin. */
    function setBase(name) {
      if (EXPANDED[name]) s.baseEmotion = name;
    }
    function setEmotion(name, intensity) {
      if (!EXPANDED[name]) return;
      s.mood = name;
      s.moodAmt = intensity == null ? 1 : Math.max(0, Math.min(1, intensity));
      s.moodHold = 2.5 + s.moodAmt * 3;
      s.stillUntil = 0;
    }
    function react(name) {
      var seq = REACTIONS[name];
      if (!seq) return;
      if (name === "wave") s.wave = 1;
      s.queue.length = 0;
      for (var i = 0; i < seq.length; i++) {
        s.queue.push({ t: seq[i][0], spec: seq[i][1] });
      }
      s.stillUntil = 0;
    }
    /* Move the live canvas to another container without rebuilding anything.
       The launcher and the panel stage are the same character in two places,
       so a second WebGL context (and a second bunny) would be both wasteful
       and wrong — this hands the existing one over instead. */
    function remount(el) {
      if (!ready || !renderer || !el || el === container) return false;
      container = el;
      el.appendChild(renderer.domElement);   // appendChild detaches from the old parent
      if (ro) { ro.disconnect(); ro.observe(el); }
      resize();
      return true;
    }
    /* nx / ny are the pull vector in stage-normalised units (1 = the drag cap),
       y positive = upward. amt is 0..1 how far into the cap the drag is. */
    function setEarPull(side, nx, ny, amt) {
      s.pull = true;
      s.pullSide = side < 0 ? -1 : 1;
      s.pullTX = nx; s.pullTY = ny;
      s.pullTA = amt == null ? 1 : amt;
      s.stillUntil = 0;
    }
    function releaseEarPull() {
      s.pull = false;
      s.pullTX = s.pullTY = s.pullTA = 0;
    }
    /* Which ear is under this screen point, if any: -1 left, +1 right, 0 none.
       Projects a point partway up each ear rather than raycasting the meshes —
       the ears are thin, and a radius around the projected point is far more
       forgiving for touch without feeling inaccurate. */
    function earHit(cx, cy, radius) {
      if (!ready || !container || !camera || !earL || !earR || !THREE) return 0;
      var r = container.getBoundingClientRect();
      if (!r.width || !r.height) return 0;
      var v = new THREE.Vector3();
      var best = 0, bestD = Infinity;
      var pairs = [[-1, earL], [1, earR]];
      for (var i = 0; i < pairs.length; i++) {
        var ear = pairs[i][1];
        ear.updateWorldMatrix(true, false);
        v.set(0, 0.62, 0).applyMatrix4(ear.matrixWorld).project(camera);
        var sx = r.left + (v.x * 0.5 + 0.5) * r.width;
        var sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
        var d = Math.sqrt((cx - sx) * (cx - sx) + (cy - sy) * (cy - sy));
        if (d < bestD) { bestD = d; best = pairs[i][0]; }
      }
      return bestD <= (radius || 26) ? best : 0;
    }
    function setFraming(name) {
      var f = FRAMES[name];
      if (!f) return;
      s.tPos = f.pos.slice();
      s.tLook = f.look.slice();
    }
    function pause() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      s.last = 0;
    }
    function resume() {
      if (!raf && ready) { s.last = 0; raf = requestAnimationFrame(loop); }
    }
    function destroy() {
      pause();
      window.removeEventListener("pointermove", onPointer);
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
      remount: remount,
      setSpeaking: setSpeaking,
      pulse: pulse,
      setMouth: setMouth,
      setThinking: setThinking,
      setListening: setListening,
      setFraming: setFraming,
      setPhoneme: setPhoneme,
      setEmotion: setEmotion,
      setBase: setBase,
      setEarPull: setEarPull,
      releaseEarPull: releaseEarPull,
      earHit: earHit,
      react: react,
      pause: pause,
      resume: resume,
      destroy: destroy,
      isReady: function () { return ready; },
      // exposed for the expression harness / debugging
      _emotions: function () { return Object.keys(EMOTIONS); },
      _debug: function (o) { if (o && o.blink === false) s.noBlink = true;
                             if (o && o.blink === true) s.noBlink = false; },
      _params: function () { return P; },
      _mood: function () { return s.mood; },
    };
  }

  window.AssistantAvatar = createAvatar;
})();
