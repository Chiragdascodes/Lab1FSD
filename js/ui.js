/* ==========================================================================
   WE RISE — ui.js

   The chrome that floats over everything, independent of the scroll story:

     Glass   · real refraction for every .lg element (Chromium), blur elsewhere
     Sound   · a generative ambient bed, built in Web Audio — no audio files
     XP      · the counter top-right; the story pays out as you move through it
     Ruler   · the tick scale top-centre that tracks how far in you are

   Exposes window.WR for app.js and gate.js.
   ========================================================================== */

(function () {
  'use strict';

  var WR = window.WR = window.WR || {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ======================================================================
     LIQUID GLASS

     Each .lg element refracts the page behind it through its own SVG filter,
     used as a backdrop-filter. The filter needs a displacement map the exact
     size of the element: neutral in the middle (no bend) and, along a rounded
     bezel, a vector pointing inward that is strongest at the rim, the way a
     thick lens edge pulls the image. Red carries x, green carries y. Maps are
     redrawn when an element changes size. Chromium only; other engines keep
     the CSS blur fallback.
     ====================================================================== */

  var SVGNS = 'http://www.w3.org/2000/svg';

  function isChromium() {
    var brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (brands) return brands.some(function (b) { return /Chromium/.test(b.brand); });
    return /Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent);
  }

  function glassMap(W, H, radius) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var cx = cv.getContext('2d');
    var img = cx.createImageData(W, H);
    var d = img.data;
    var r = Math.min(radius, H / 2, W / 2);
    var bezel = Math.max(6, r * 0.8);

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var px = x + 0.5, py = y + 0.5;
        /* nearest point on the rounded rectangle's inner core */
        var sx = Math.max(r, Math.min(W - r, px));
        var sy = Math.max(r, Math.min(H - r, py));
        var vx = px - sx, vy = py - sy;
        var len = Math.sqrt(vx * vx + vy * vy);
        var R = 128, G = 128;
        if (len > 0) {
          var edge = r - len;
          if (edge < bezel) {
            var t = 1 - Math.max(0, edge) / bezel;
            var m = t * t * t;
            R = 128 - (vx / len) * m * 127;
            G = 128 - (vy / len) * m * 127;
          }
        }
        var o = (y * W + x) * 4;
        d[o] = R; d[o + 1] = G; d[o + 2] = 128; d[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }

  function initGlass() {
    var els = document.querySelectorAll('.lg');
    if (!els.length || !isChromium()) return;

    var defs = document.createElementNS(SVGNS, 'svg');
    defs.setAttribute('class', 'lg-defs');
    defs.setAttribute('aria-hidden', 'true');
    document.body.appendChild(defs);

    Array.prototype.forEach.call(els, function (el, n) {
      var id = 'lg-f' + n;
      var filter = document.createElementNS(SVGNS, 'filter');
      filter.setAttribute('id', id);
      filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.innerHTML =
        '<feImage x="0" y="0" preserveAspectRatio="none" result="map"/>' +
        '<feGaussianBlur in="SourceGraphic" stdDeviation="' + (el.dataset.frost || 1.4) + '" result="frost"/>' +
        '<feDisplacementMap in="frost" in2="map" xChannelSelector="R" yChannelSelector="G" result="bent"/>' +
        '<feColorMatrix in="bent" type="saturate" values="1.5"/>';
      defs.appendChild(filter);

      var feImage = filter.querySelector('feImage');
      var disp = filter.querySelector('feDisplacementMap');
      var lastW = 0, lastH = 0;

      function draw() {
        var W = Math.round(el.offsetWidth), H = Math.round(el.offsetHeight);
        if (!W || !H || (W === lastW && H === lastH)) return;
        lastW = W; lastH = H;
        var radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || H / 2;
        var url = glassMap(W, H, radius);
        feImage.setAttribute('href', url);
        feImage.setAttribute('width', W);
        feImage.setAttribute('height', H);
        filter.setAttribute('width', W);
        filter.setAttribute('height', H);
        disp.setAttribute('scale', Math.round(Math.min(36, Math.min(W, H) * 0.6)));
        el.style.setProperty('--lg-filter', 'url(#' + id + ')');
        el.classList.add('lg-on');
      }

      draw();
      if (window.ResizeObserver) new ResizeObserver(draw).observe(el);
    });
  }

  WR.cursorMode = function () {};

  /* ======================================================================
     SOUND

     A slow pad in A major built from detuned oscillators through a moving
     low-pass and a generated reverb, with the occasional bell from a
     pentatonic set. Everything is synthesised, so there is nothing to load.
     It can only start from a user gesture (browser policy), which the gate
     provides. The choice is remembered for the next visit.
     ====================================================================== */

  var audio = null;
  var soundOn = true;
  try { soundOn = localStorage.getItem('wr-sound') !== 'off'; } catch (e) {}

  function impulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var ch = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function buildAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();

    var master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    var verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 4.2, 2.6);
    var wet = ctx.createGain(); wet.gain.value = 0.85;
    verb.connect(wet); wet.connect(master);

    var dry = ctx.createGain(); dry.gain.value = 0.35;
    dry.connect(master);

    /* the pad */
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 780; lp.Q.value = 0.4;
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    var lfoAmt = ctx.createGain(); lfoAmt.gain.value = 360;
    lfo.connect(lfoAmt); lfoAmt.connect(lp.frequency); lfo.start();

    var padGain = ctx.createGain(); padGain.gain.value = 0.05;
    lp.connect(padGain); padGain.connect(dry); padGain.connect(verb);

    [110, 164.81, 220, 277.18, 329.63].forEach(function (f, i) {
      ['sine', 'triangle'].forEach(function (type, j) {
        var o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = (j ? 7 : -5) + i;
        var g = ctx.createGain();
        g.gain.value = type === 'sine' ? 0.5 : 0.18;
        /* each voice breathes on its own slow cycle */
        var trem = ctx.createOscillator(); trem.frequency.value = 0.03 + i * 0.013;
        var tremAmt = ctx.createGain(); tremAmt.gain.value = 0.22;
        trem.connect(tremAmt); tremAmt.connect(g.gain); trem.start();
        o.connect(g); g.connect(lp); o.start();
      });
    });

    function bell(freq, when, vol, len) {
      var t = when || ctx.currentTime;
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.76;
      var g = ctx.createGain();
      var g2 = ctx.createGain(); g2.gain.value = 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.06, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (len || 2.6));
      o.connect(g); o2.connect(g2); g2.connect(g);
      g.connect(verb); g.connect(dry);
      o.start(t); o2.start(t);
      o.stop(t + (len || 2.6) + 0.1); o2.stop(t + (len || 2.6) + 0.1);
    }

    var scale = [440, 493.88, 554.37, 659.25, 739.99, 880];
    (function drift() {
      if (soundOn && ctx.state === 'running' && mood === 'calm') {
        bell(scale[Math.floor(Math.random() * scale.length)], 0, 0.028, 3.2);
      }
      setTimeout(drift, 3200 + Math.random() * 4200);
    })();

    /* ---- the dark layer: a low drone, a minor pad and a slow pulse, silent
       until the story turns ---- */
    var dark = ctx.createGain(); dark.gain.value = 0;
    dark.connect(master); dark.connect(verb);

    var droneLp = ctx.createBiquadFilter(); droneLp.type = 'lowpass'; droneLp.frequency.value = 220; droneLp.Q.value = 3;
    var droneGain = ctx.createGain(); droneGain.gain.value = 0.16;
    droneLp.connect(droneGain); droneGain.connect(dark);
    [55, 55.35, 27.5].forEach(function (f, i) {
      var o = ctx.createOscillator(); o.type = i === 2 ? 'sine' : 'sawtooth'; o.frequency.value = f;
      var g = ctx.createGain(); g.gain.value = i === 2 ? 0.8 : 0.35;
      o.connect(g); g.connect(droneLp); o.start();
    });

    var minorLp = ctx.createBiquadFilter(); minorLp.type = 'lowpass'; minorLp.frequency.value = 900;
    var minorGain = ctx.createGain(); minorGain.gain.value = 0.07;
    minorLp.connect(minorGain); minorGain.connect(dark);
    [110, 130.81, 164.81, 220, 246.94].forEach(function (f, i) {
      var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = (i % 2 ? 6 : -6);
      var g = ctx.createGain(); g.gain.value = 0.3;
      var trem = ctx.createOscillator(); trem.frequency.value = 0.08 + i * 0.03;
      var ta = ctx.createGain(); ta.gain.value = 0.18;
      trem.connect(ta); ta.connect(g.gain); trem.start();
      o.connect(g); g.connect(minorLp); o.start();
    });

    /* a slow, heavy pulse under the room */
    (function pulse() {
      if (mood !== 'calm' && soundOn && ctx.state === 'running') {
        var t = ctx.currentTime;
        [0, 0.28].forEach(function (off, k) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(k ? 58 : 64, t + off);
          o.frequency.exponentialRampToValueAtTime(34, t + off + 0.35);
          g.gain.setValueAtTime(0.0001, t + off);
          g.gain.exponentialRampToValueAtTime(k ? 0.28 : 0.42, t + off + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.5);
          o.connect(g); g.connect(dark); o.start(t + off); o.stop(t + off + 0.6);
        });
      }
      setTimeout(pulse, mood === 'red' ? 1500 : 2200);
    })();

    /* a riser: filtered noise that climbs with the hold */
    var nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (var n = 0; n < nd.length; n++) nd[n] = Math.random() * 2 - 1;
    var noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    var riserBp = ctx.createBiquadFilter(); riserBp.type = 'bandpass'; riserBp.frequency.value = 300; riserBp.Q.value = 2.2;
    var riser = ctx.createGain(); riser.gain.value = 0;
    noise.connect(riserBp); riserBp.connect(riser); riser.connect(master); riser.connect(verb); noise.start();

    /* the room's first chord: a low minor swell with its filter falling */
    function hit() {
      var t = ctx.currentTime + 0.05;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 5);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      lp.connect(g); g.connect(master); g.connect(verb);
      [55, 82.41, 110, 130.81, 164.81].forEach(function (fq, i) {
        [-9, 9].forEach(function (d) {
          var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq; o.detune.value = d + (i ? 0 : 0);
          o.connect(lp); o.start(t); o.stop(t + 6.2);
        });
      });
    }

    return { ctx: ctx, master: master, bell: bell, padGain: padGain, dark: dark, droneLp: droneLp, droneGain: droneGain, minorLp: minorLp, riser: riser, riserBp: riserBp, hit: hit };
  }

  function setLevel(on) {
    if (!audio) return;
    var g = audio.master.gain, t = audio.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? 0.55 : 0, t + (on ? 2.4 : 0.6));
  }

  function reflectSound() {
    var btn = document.getElementById('sound');
    if (!btn) return;
    btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    btn.classList.toggle('is-playing', soundOn && !!audio);
  }

  /* called from a user gesture */
  WR.startSound = function () {
    if (!audio) audio = buildAudio();
    if (!audio) return;
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    setLevel(soundOn);
    reflectSound();
    /* if the story had already turned before sound could start, catch up */
    if (mood !== 'calm') { WR._forceMood = true; WR.setMood(mood, moodAmount); WR._forceMood = false; }
  };

  /* ---- mood ---------------------------------------------------------------
     calm    · the pad and its bells
     tension · the drone creeps in under the hold (amount 0..1)
     red     · the pad drops away; drone, minor pad and pulse take over */
  var mood = 'calm', moodAmount = 1;
  function ramp(param, value, secs) {
    var t = audio.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + secs);
  }
  WR.setMood = function (name, amount) {
    var a = amount == null ? 1 : amount;
    if (name === mood && name !== 'tension' && !WR._forceMood) return;
    mood = name; moodAmount = a;
    if (!audio) return;
    if (name === 'red') {
      if (soundOn && audio.ctx.state === 'running' && !WR._forceMood) audio.hit();
      ramp(audio.riser.gain, 0, 0.4);
      ramp(audio.padGain.gain, 0.008, 2.5);
      ramp(audio.dark.gain, 0.9, 2);
      ramp(audio.droneLp.frequency, 320, 3);
      ramp(audio.minorLp.frequency, 1400, 4);
    } else if (name === 'tension') {
      ramp(audio.padGain.gain, 0.05 * (1 - a * 0.8), 0.3);
      ramp(audio.dark.gain, 0.15 + a * 0.75, 0.3);
      ramp(audio.droneLp.frequency, 160 + a * 900, 0.3);
      ramp(audio.minorLp.frequency, 500 + a * 700, 0.3);
      ramp(audio.riser.gain, a * a * 0.1, 0.3);
      ramp(audio.riserBp.frequency, 300 + a * a * 2800, 0.3);
    } else {
      ramp(audio.padGain.gain, 0.05, 2.5);
      ramp(audio.dark.gain, 0, 2);
      ramp(audio.droneLp.frequency, 220, 2);
      ramp(audio.riser.gain, 0, 1);
    }
  };

  /* a single low heartbeat, for the cracks */
  WR.heartbeat = function () {
    if (!audio || !soundOn) return;
    var ctx = audio.ctx, t = ctx.currentTime + 0.01;
    [0, 0.22].forEach(function (off, k) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(k ? 52 : 60, t + off);
      o.frequency.exponentialRampToValueAtTime(32, t + off + 0.3);
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(k ? 0.35 : 0.55, t + off + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.42);
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.5);
    });
  };

  WR.chime = function () {
    if (!audio || !soundOn) return;
    var t = audio.ctx.currentTime;
    audio.bell(659.25, t, 0.07, 2.4);
    audio.bell(880, t + 0.11, 0.06, 2.6);
    audio.bell(1318.5, t + 0.22, 0.045, 3.2);
  };

  WR.tick = function () {
    if (!audio || !soundOn) return;
    audio.bell(1760, 0, 0.018, 0.9);
  };

  /* ---- glass breaking ------------------------------------------------------
     Synthesised in layers, the way a real break sounds: a low body thump, a
     sharp broadband crack, a hiss of fine fragments, and then dozens of
     small glass pieces ringing and landing — bright, short, detuned pings
     scattered over the next second, thick at first and thinning out. It is
     routed straight to the output so it cuts through the ambient bed. */
  WR.shatter = function () {
    if (!soundOn) return;
    if (!audio) WR.startSound();
    if (!audio) return;
    var ctx = audio.ctx, t = ctx.currentTime + 0.01;
    if (ctx.state === 'suspended') ctx.resume();

    var out = ctx.createGain();
    out.gain.value = 0.9;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    out.connect(comp); comp.connect(ctx.destination);

    function noiseBuf(seconds) {
      var len = Math.floor(ctx.sampleRate * seconds);
      var b = ctx.createBuffer(1, len, ctx.sampleRate), ch = b.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      return b;
    }

    /* the body of the impact */
    var thump = ctx.createOscillator(), tg = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    thump.connect(tg); tg.connect(out);
    thump.start(t); thump.stop(t + 0.5);

    /* the crack */
    var crack = ctx.createBufferSource();
    crack.buffer = noiseBuf(0.5);
    var cbp = ctx.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 2600; cbp.Q.value = 0.6;
    var cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    crack.connect(cbp); cbp.connect(cg); cg.connect(out);
    crack.start(t);

    /* fine fragments hissing apart */
    var hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuf(1.4);
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    hiss.connect(hp); hp.connect(hg); hg.connect(out);
    hiss.start(t);

    /* the pieces: short bright pings, dense at first, thinning out */
    for (var i = 0; i < 46; i++) {
      var at = t + 0.02 + Math.pow(Math.random(), 2.2) * 1.1;
      var f = 2200 + Math.random() * 7400;
      var len = 0.04 + Math.random() * 0.22;
      var vol = (0.05 + Math.random() * 0.11) * (1 - (at - t) / 1.4);
      [1, 1.0068].forEach(function (k) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = Math.random() > 0.5 ? 'sine' : 'triangle';
        o.frequency.value = f * k;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g); g.connect(out);
        o.start(at); o.stop(at + len + 0.02);
      });
    }
  };

  function initSound() {
    var btn = document.getElementById('sound');
    if (!btn) return;
    reflectSound();
    btn.addEventListener('click', function () {
      soundOn = !soundOn;
      try { localStorage.setItem('wr-sound', soundOn ? 'on' : 'off'); } catch (e) {}
      if (soundOn) WR.startSound(); else setLevel(false);
      reflectSound();
    });
  }

  /* ======================================================================
     XP

     The counter only ever goes up, and every rise is announced by a small
     float-away tag. Awards are keyed so scrolling back over a moment never
     pays twice.
     ====================================================================== */

  var xp = { value: 0, shown: 0 };
  var paid = {};

  WR.award = function (key, amount) {
    if (paid[key]) return;
    paid[key] = true;
    var pill = document.getElementById('xp');
    var num = document.getElementById('xp-n');
    if (!pill || !num) return;

    xp.value += amount;
    gsap.to(xp, {
      shown: xp.value,
      duration: reduced ? 0 : 1.1,
      ease: 'power3.out',
      onUpdate: function () { num.textContent = Math.round(xp.shown); }
    });

    pill.classList.remove('is-bump');
    void pill.offsetWidth;
    pill.classList.add('is-bump');

    if (!reduced) {
      var tag = document.createElement('span');
      tag.className = 'xp-float';
      tag.textContent = '+' + amount;
      pill.appendChild(tag);
      gsap.fromTo(tag, { y: 0, autoAlpha: 0 }, {
        y: 26, autoAlpha: 1, duration: 0.5, ease: 'power2.out',
        onComplete: function () {
          gsap.to(tag, { y: 40, autoAlpha: 0, duration: 0.6, delay: 0.5, onComplete: function () { tag.remove(); } });
        }
      });
    }
    WR.tick();
  };

  /* ======================================================================
     RULER

     A row of ticks with one marker that slides along them as the page is
     read. Written from app.js with a 0–1 value.
     ====================================================================== */

  function initRuler() {
    var host = document.getElementById('ruler-ticks');
    if (!host) return;
    var N = 29;
    for (var i = 0; i < N; i++) {
      var t = document.createElement('i');
      if (i % 7 === 0) t.className = 'is-major';
      host.appendChild(t);
    }
    var marker = document.getElementById('ruler-mark');
    var last = -1;
    WR.progress = function (p) {
      var v = Math.round(p * 1000) / 1000;
      if (v === last || !marker) return;
      last = v;
      marker.style.transform = 'translate3d(' + (v * 100).toFixed(1) + '%,0,0)';
    };
  }

  /* ---- go ---- */
  initGlass();
  initSound();
  initRuler();
  WR.refreshGlass = initGlass;
})();
