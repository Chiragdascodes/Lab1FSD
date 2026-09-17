/* ==========================================================================
   WE RISE — app.js

   One pinned stage carries the whole story, measured in screens of scroll:

     Intro   · "You Believed" alone on white; the figure rises out of mist
               and falling snow as the line lifts away
     Hero    · 300 WebP frames scrubbed on a canvas. Five beats, each one
               sentence split across the figure: high on one side, low on
               the other
     Portal  · after the hero's last frame, scrolling sinks it into black;
               a breath, then the black shatters (with sound) into the red
               room (portal.js)
     Red     · rising red flame behind a reaching hand. "But," · "That's
               Bullsh*t" · broken glass carrying the numbers (shards.js),
               overexposing to white from the centre
     Quote   · the line resolves out of the white, soft to sharp
     Close   · the waitlist

   Loading happens behind the gate (gate.js); the chrome, sound, cursor and
   XP live in ui.js. GSAP, ScrollTrigger and ScrollSmoother are vendored.
   ========================================================================== */

(function () {
  'use strict';

  var WR = window.WR = window.WR || {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

  var smoother = null;
  if (!reduced && typeof ScrollSmoother !== 'undefined') {
    try {
      smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: 0.9,
        effects: false,
        normalizeScroll: true
      });
    } catch (err) {
      smoother = null;
    }
  }

  function seg(p, a, b) {
    return Math.max(0, Math.min(1, (p - a) / (b - a)));
  }

  /* write a style only when its value changes */
  function setStyle(el, prop, value) {
    if (!el) return;
    var key = '_s_' + prop;
    if (el[key] === value) return;
    el[key] = value;
    el.style[prop] = value;
  }

  /* ======================================================================
     THE FILM
     ====================================================================== */

  var FRAMES = 300;
  var FRAME_SRC = 'assets/frames/f';

  var canvas = document.getElementById('film');
  var ctx = canvas ? canvas.getContext('2d', { alpha: true }) : null;
  var stage = document.getElementById('stage');

  var images = [];
  var decoded = [];
  var painted = -1;
  var seq = { frame: 0 };

  function pad(n) { return ('00' + n).slice(-3); }

  function sizeCanvas() {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    var w = Math.round(canvas.clientWidth * dpr);
    var h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      painted = -1;
    }
  }

  function nearest(i) {
    if (decoded[i]) return i;
    for (var d = 1; d < FRAMES; d++) {
      if (decoded[i - d]) return i - d;
      if (decoded[i + d]) return i + d;
    }
    return -1;
  }

  /* ---- where the figure is ----------------------------------------------
     Measured from the frames themselves: for every frame, the silhouette's
     left and right extent in each of BAND_COUNT horizontal bands. The type is
     then sized against the exact bands it sits beside. */
  var BAND_COUNT = 12;
  var bounds = [];
  var measured = null;

  var probe = null, pc = null;

  function measureFrom(start) {
    var PW = 160, PH = 90, CUT = 24, BUDGET = 24;
    if (!probe) {
      probe = document.createElement('canvas');
      probe.width = PW; probe.height = PH;
      pc = probe.getContext('2d', { willReadFrequently: true });
    }
    if (!pc) { if (measured) measured(); return; }

    var done = 0, i;
    for (i = start; i < FRAMES && done < BUDGET; i++) {
      if (bounds[i]) continue;
      var img = images[i];
      if (!img || !img.naturalWidth) continue;

      pc.clearRect(0, 0, PW, PH);
      pc.drawImage(img, 0, 0, PW, PH);
      var d;
      try { d = pc.getImageData(0, 0, PW, PH).data; } catch (e) { i = FRAMES; break; }

      var band = [];
      for (var bi = 0; bi < BAND_COUNT; bi++) {
        var y0 = Math.floor(bi * PH / BAND_COUNT);
        var y1 = Math.floor((bi + 1) * PH / BAND_COUNT);
        var lo = 1, hi = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * PW;
          for (var x = 0; x < PW; x++) {
            if (d[(row + x) * 4 + 3] > CUT) {
              var f = x / PW;
              if (f < lo) lo = f;
              if (f > hi) hi = f;
            }
          }
        }
        band[bi] = (hi > lo) ? { l: lo, r: hi } : null;
      }
      bounds[i] = band;
      done++;
    }

    if (i < FRAMES) {
      /* behind the gate, so there is nothing to protect: keep going. A timer,
         not rAF, which stalls in a background tab. */
      WR.gateProgress(0.9 + 0.1 * (i / FRAMES));
      setTimeout(function () { measureFrom(i); }, 0);
    } else {
      painted = -1;
      fitBeats();
      draw();
      if (measured) { var cb = measured; measured = null; cb(); }
    }
  }

  function boundsFor(i) {
    if (bounds[i]) return bounds[i];
    for (var d = 1; d < FRAMES; d++) {
      if (bounds[i - d]) return bounds[i - d];
      if (bounds[i + d]) return bounds[i + d];
    }
    return null;
  }

  /* Phones in portrait get their own framing: cover-scaling a 16:9 frame to
     a tall screen blows the figure up until nothing else fits. Keep in step
     with the matching media query in app.css. */
  var phoneMQ = window.matchMedia('(max-width: 899px) and (orientation: portrait)');
  var PHONE_FIGURE = 0.64;

  function coverRect(img, cw, ch) {
    var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    var dw = img.naturalWidth * scale;
    var dh = img.naturalHeight * scale;
    return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
  }

  /* Desktop: true cover, dead centre. Phone: smaller and standing on the
     bottom edge, still centred. The frames are transparent round the figure,
     so no edge of the smaller frame shows. */
  function frameRect(img, cw, ch) {
    if (!phoneMQ.matches) return coverRect(img, cw, ch);
    var ar = img.naturalWidth / img.naturalHeight;
    var dh = ch * PHONE_FIGURE, dw = dh * ar;
    if (dw < cw) { dw = cw; dh = dw / ar; }
    return { x: (cw - dw) / 2, y: ch - dh, w: dw, h: dh };
  }

  /* The silhouette's widest left and right screen edges (CSS px) for frame
     i, across a vertical range given as fractions of the stage height. */
  function figEdges(i, top, bottom) {
    var band = boundsFor(i);
    var img = images[nearest(i)];
    if (!band || !img || !img.naturalWidth || !canvas.width) return null;

    var cw = canvas.width, ch = canvas.height;
    var r = frameRect(img, cw, ch);
    var b0 = Math.floor(((ch * top) - r.y) / r.h * BAND_COUNT);
    var b1 = Math.floor(((ch * bottom) - r.y) / r.h * BAND_COUNT);
    b0 = Math.max(0, b0); b1 = Math.min(BAND_COUNT - 1, b1);
    var lo = 1, hi = 0, got = false;
    for (var bi = b0; bi <= b1; bi++) {
      var e = band[bi];
      if (e) { if (e.l < lo) lo = e.l; if (e.r > hi) hi = e.r; got = true; }
    }
    if (!got) return { l: Infinity, r: -Infinity };      /* nothing there */
    var k = canvas.clientWidth / cw;
    return { l: (r.x + lo * r.w) * k, r: (r.x + hi * r.w) * k };
  }

  WR.heroCanvas = canvas;
  WR.heroFrame = function () { return images[nearest(FRAMES - 1)]; };
  WR.heroFrameRect = function (img, w, h) { return frameRect(img, w, h); };

  function paint(i) {
    if (!ctx || i < 0) return;
    var img = images[i];
    if (!img || !img.naturalWidth) return;
    var r = frameRect(img, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    painted = i;
    warm(images, decoded, i);
  }

  /* Decode ahead of the scrub, off the main thread, so the next few frames
     in the direction of travel are ready before they are asked for. */
  var lastWarm = -1;
  function warm(list, have, i) {
    var dir = i >= lastWarm ? 1 : -1;
    lastWarm = i;
    for (var k = 1; k <= 6; k++) {
      var j = i + k * dir;
      var im = list[j];
      if (!im || !have[j] || im._warm) continue;
      im._warm = true;
      if (im.decode) im.decode().catch(function () {});
    }
  }

  function draw() {
    var i = Math.min(FRAMES - 1, Math.max(0, Math.round(seq.frame)));
    if (i === painted) return;
    paint(nearest(i));
  }

  var ready = 0;

  function preload() {
    for (var i = 0; i < FRAMES; i++) {
      (function (n) {
        var img = new Image();
        img.decoding = 'async';
        var counted = false;
        var count = function () {
          if (counted) return;
          counted = true;
          decoded[n] = (img.naturalWidth > 0);
          ready++;
          WR.gateProgress(0.9 * ready / FRAMES);
          if (painted === -1) paint(nearest(0));
          if (ready >= FRAMES) framesIn();
        };
        img.onload = function () {
          if (img.decode) img.decode().then(count, count);
          else count();
        };
        img.onerror = count;
        img.src = FRAME_SRC + pad(n) + '.webp';
        images[n] = img;
      })(i);
    }
  }

  /* ======================================================================
     THE BEATS
     ====================================================================== */

  var beats = Array.prototype.slice.call(document.querySelectorAll('.beat'));
  var beatAt = beats.map(function (el) {
    return parseFloat(el.getAttribute('data-at')) || 0;
  });

  /* Each beat owns the stretch from its own mark to the next: in over the
     first slice, fully present, gone a hair before the next arrives. */
  function runBeats(p) {
    for (var i = 0; i < beats.length; i++) {
      var from = beatAt[i];
      var to = (i + 1 < beatAt.length) ? beatAt[i + 1] : 1.0;
      var span = to - from;
      var a = from + span * 0.02;
      var b = from + span * 0.16;
      var c = to - span * 0.16;
      var d = to - span * 0.02;

      var el = beats[i];
      var o;
      if (p <= a || p >= d) o = 0;
      else if (p < b) o = (p - a) / (b - a);
      else if (p <= c) o = 1;
      else o = 1 - (p - c) / (d - c);
      o = Math.max(0, Math.min(1, o));

      var o3 = o.toFixed(3);
      if (el._o !== o3) { el._o = o3; el.style.opacity = o3; }

      /* the story pays out as you read it */
      if (p >= b && WR.award) WR.award('beat' + i, 50);
    }
  }

  /* ---- fitting the type ---------------------------------------------------
     The parts are hung from the gutter and never given a width. For each
     part: its natural width at full size, and the narrowest gap the figure
     leaves beside it — at its own height, across every frame the beat is on
     screen. The beat is scaled to the tighter of its two parts, so the two
     halves of a sentence always share a size. */

  var PART_Y = { a: 0.31, b: 0.71 };            /* keep in step with app.css */

  function cssPx(el, value) {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:' + value;
    el.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    el.removeChild(probe);
    return w;
  }

  function textWidth(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width;
  }

  function fitBeats() {
    if (!stage || !beats.length) return;
    var narrow = phoneMQ.matches;
    var stageW = stage.clientWidth, stageH = stage.clientHeight;
    var gut = cssPx(stage, 'var(--beat-gut)');
    var gap = cssPx(stage, 'var(--fig-gap)');
    var fits = [];

    for (var k = 0; k < beats.length; k++) {
      var el = beats[k];
      el.style.setProperty('--fit', '1');
      var flip = el.getAttribute('data-flip') === '1';
      var from = beatAt[k];
      var to = (k + 1 < beatAt.length) ? beatAt[k + 1] : 1;
      var f0 = Math.max(0, Math.floor(from * (FRAMES - 1)));
      var f1 = Math.min(FRAMES - 1, Math.ceil(to * (FRAMES - 1)));
      var fit = 1;

      ['a', 'b'].forEach(function (key) {
        var part = el.querySelector('.part-' + key);
        if (!part) return;
        var w = 0;
        for (var q = 0; q < part.children.length; q++) {
          w = Math.max(w, textWidth(part.children[q]));
        }
        /* script capitals throw their flourish past the advance width */
        w *= 1.06;
        if (!w) return;

        var col;
        if (narrow) {
          col = stageW - gut * 2;
        } else {
          var left = (key === 'a') !== flip;
          var h = part.getBoundingClientRect().height;
          var top = (stageH * PART_Y[key] - h / 2) / stageH;
          var bottom = (stageH * PART_Y[key] + h / 2) / stageH;
          col = Infinity;
          for (var f = f0; f <= f1; f++) {
            var e = figEdges(f, top, bottom);
            if (!e) continue;
            var c = left ? (e.l - gap - gut) : (stageW - gut - (e.r + gap));
            if (c < col) col = c;
          }
          if (col === Infinity || col > stageW) col = stageW * 0.36 - gap - gut;
        }
        fit = Math.min(fit, (col * 0.98) / w);
      });

      fits.push(Math.max(0.3, Math.min(1, fit)));
    }

    /* one size across the sequence where possible, capped per beat */
    var sorted = fits.slice().sort(function (a, b) { return a - b; });
    var shared = sorted[Math.floor(sorted.length / 2)];
    for (var j = 0; j < beats.length; j++) {
      beats[j].style.setProperty('--fit', Math.min(shared, fits[j]).toFixed(4));
    }

    fitQuote();
  }

  function fitQuote() {
    var quote = document.querySelector('.quote');
    if (!quote) return;
    quote.style.setProperty('--q-fit', '1');
    var host = quote.parentNode;
    var lines = quote.querySelectorAll('.q-line'), w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, textWidth(lines[i]));
    var room = host.clientWidth - cssPx(host, 'calc(var(--gut) * 2)');
    if (w > room) quote.style.setProperty('--q-fit', (room * 0.98 / w).toFixed(4));
  }

  /* ======================================================================
     MIST AND SNOW — what the figure rises out of
     ====================================================================== */

  var SVGNS = 'http://www.w3.org/2000/svg';

  function buildCloudBank(host, puffs, blurId, blur) {
    if (!host) return;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 1200 800');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.innerHTML =
      '<defs><filter id="' + blurId + '" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="' + blur + '"/></filter></defs>';
    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('filter', 'url(#' + blurId + ')');
    puffs.forEach(function (p, i) {
      var e = document.createElementNS(SVGNS, 'ellipse');
      e.setAttribute('cx', p[0]); e.setAttribute('cy', p[1]);
      e.setAttribute('rx', p[2]); e.setAttribute('ry', p[3]);
      e.setAttribute('fill', p[4] || '#ffffff');
      e.setAttribute('opacity', (0.8 + (i % 4) * 0.05).toFixed(2));
      g.appendChild(e);
    });
    svg.appendChild(g);
    host.appendChild(svg);
  }

  function buildClouds() {
    buildCloudBank(document.getElementById('clouds'), [
      [180, 520, 240, 150], [420, 470, 300, 185], [700, 505, 265, 160],
      [960, 480, 285, 175], [300, 620, 320, 175], [820, 640, 340, 190],
      [560, 690, 380, 200], [60, 700, 300, 180], [1120, 660, 300, 185],
      [640, 380, 200, 120], [980, 330, 170, 105], [260, 360, 185, 112]
    ], 'cloud-soft', 26);

    /* the mist sits over the figure's whole body and thins toward the top,
       so the head is the first thing that shows through */
    buildCloudBank(document.getElementById('mist'), [
      [600, 700, 520, 260], [300, 760, 360, 200], [900, 760, 380, 210],
      [600, 520, 360, 220], [430, 600, 260, 170], [780, 600, 280, 170],
      [600, 380, 250, 170], [120, 620, 260, 190], [1080, 620, 260, 190],
      [600, 250, 180, 120, '#f7fbf9']
    ], 'mist-soft', 34);
  }

  var snow = { cv: null, cx: null, flakes: [], alpha: 0, w: 0, h: 0, sprite: null, vel: 0, idle: 0 };

  function initSnow() {
    snow.cv = document.getElementById('snow');
    if (!snow.cv || reduced) return;
    snow.cx = snow.cv.getContext('2d');

    /* a soft flake with a faint sea-green edge, so it still reads on white */
    var s = document.createElement('canvas');
    s.width = s.height = 32;
    var g = s.getContext('2d');
    var grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.62, 'rgba(205,228,219,0.5)');
    grad.addColorStop(1, 'rgba(170,205,192,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    snow.sprite = s;

    function size() {
      var dpr = Math.min(devicePixelRatio || 1, 1.5);
      snow.w = snow.cv.clientWidth; snow.h = snow.cv.clientHeight;
      snow.cv.width = Math.round(snow.w * dpr);
      snow.cv.height = Math.round(snow.h * dpr);
      snow.cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener('resize', size);

    var count = Math.round(Math.min(160, snow.w * snow.h / 9000));
    for (var i = 0; i < count; i++) {
      var z = Math.random();                           /* depth: 0 far, 1 near */
      snow.flakes.push({
        x: Math.random() * snow.w,
        y: Math.random() * snow.h,
        z: z,
        r: 1.5 + z * z * 7,
        vy: 12 + z * 38,
        sway: 6 + Math.random() * 18,
        ph: Math.random() * Math.PI * 2,
        fq: 0.3 + Math.random() * 0.7
      });
    }

    var last = performance.now(), t = 0, cleared = false;
    (function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt;
      if (snow.alpha > 0.01) {
        cleared = false;
        var c = snow.cx;
        c.clearRect(0, 0, snow.w, snow.h);
        c.globalAlpha = snow.alpha;
        /* the scroll pushes the flakes: near ones more than far ones */
        snow.vel *= 0.92;
        for (var i = 0; i < snow.flakes.length; i++) {
          var f = snow.flakes[i];
          f.y += (f.vy - snow.vel * (0.4 + f.z)) * dt;
          var x = f.x + Math.sin(t * f.fq + f.ph) * f.sway;
          if (f.y > snow.h + 12) { f.y = -12; f.x = Math.random() * snow.w; }
          if (f.y < -14) { f.y = snow.h + 10; f.x = Math.random() * snow.w; }
          var d = f.r * 2;
          c.drawImage(snow.sprite, x - f.r, f.y - f.r, d, d);
        }
        c.globalAlpha = 1;
      } else if (!cleared) {
        snow.cx.clearRect(0, 0, snow.w, snow.h);
        cleared = true;
      }
      requestAnimationFrame(loop);
    })(last);
  }

  /* ======================================================================
     WEIGHT — the type lags a fast scroll and settles when you stop
     ====================================================================== */

  var drag = { y: 0 };
  var dragIdle = null;
  var dragTo = null;

  function applyDrag() {
    if (stage) stage.style.setProperty('--vel', drag.y.toFixed(2) + 'px');
  }

  function feelVelocity(v) {
    if (reduced) return;
    var target = Math.max(-40, Math.min(40, -v / 90));
    if (!dragTo) {
      dragTo = gsap.quickTo(drag, 'y', { duration: 0.35, ease: 'power2.out', onUpdate: applyDrag });
    }
    dragTo(target);
    if (dragIdle) clearTimeout(dragIdle);
    dragIdle = setTimeout(function () {
      dragTo = null;
      gsap.to(drag, { y: 0, duration: 0.85, ease: 'elastic.out(1, 0.75)', overwrite: true, onUpdate: applyDrag });
    }, 120);
  }

  /* ======================================================================
     THE PIN — intro, hero, portal, red room and quote on one stage
     ====================================================================== */

  var INTRO = 1.5;
  var HERO = 6.2;
  var PORTAL = 1.0;
  var RED = 7.0;
  var QUOTE = 2.6;
  var TOTAL = INTRO + HERO + PORTAL + RED + QUOTE;
  var pinST = null;

  function initFilm() {
    if (!canvas || !ctx) return;

    sizeCanvas();
    preload();
    buildClouds();
    initSnow();

    var title = document.getElementById('title');
    var hint = document.getElementById('hint');
    var mist = document.getElementById('mist');
    var clouds = document.getElementById('clouds');
    var wash = document.getElementById('wash');

    runBeats(-1);
    fitBeats();

    if (reduced) {
      setStyle(canvas, 'opacity', '1');
      setStyle(mist, 'opacity', '0');
      paint(nearest(Math.round(FRAMES * 0.72)));
      return;
    }

    pinST = ScrollTrigger.create({
      trigger: '#act-one',
      start: 'top top',
      end: function () { return '+=' + window.innerHeight * TOTAL; },
      pin: '#stage',
      scrub: true,
      invalidateOnRefresh: true,
      onRefresh: function () {
        sizeCanvas(); painted = -1; draw(); fitBeats();
        if (WR.shards) WR.shards.resize();
      },
      onLeave: releaseDark,
      onLeaveBack: releaseDark,
      onUpdate: function (self) {
        var screens = self.progress * TOTAL;
        var ip = seg(screens, 0, INTRO);
        var p = seg(screens, INTRO, INTRO + HERO);
        var v = self.getVelocity();

        /* ---- intro: the line lifts away, the figure rises through mist ---- */
        var tOut = seg(ip, 0.08, 0.55);
        setStyle(title, 'opacity', (1 - tOut).toFixed(3));
        setStyle(title, 'transform',
          'translate(-50%, calc(-54% - ' + (tOut * 7).toFixed(2) + 'vh)) scale(' + (1 + tOut * 0.1).toFixed(3) + ')');
        setStyle(hint, 'opacity', (1 - seg(ip, 0, 0.18)).toFixed(3));

        var rise = seg(ip, 0.22, 1);
        var riseE = 1 - Math.pow(1 - rise, 3);
        setStyle(canvas, 'opacity', riseE.toFixed(3));
        setStyle(canvas, 'transform', 'translate3d(0,' + ((1 - riseE) * 6).toFixed(2) + 'vh,0) scale(' + (1.06 - riseE * 0.06).toFixed(3) + ')');
        var m = seg(ip, 0.3, 1);
        setStyle(mist, 'opacity', (1 - m).toFixed(3));
        setStyle(mist, 'transform', 'translate3d(0,' + (m * 10).toFixed(2) + 'vh,0) scale(' + (1 + m * 0.7).toFixed(3) + ')');

        snow.alpha = screens < INTRO ? 1 : 1 - seg(p, 0, 0.14);
        snow.vel = v / 4;

        /* ---- hero ---- */
        seq.frame = p * (FRAMES - 1);
        runBeats(screens > INTRO ? p : -1);
        draw();
        feelVelocity(v);

        /* ---- the hero ends on its last frame; the portal holds it there,
           then the red room, then the quote ---- */
        var portalFrom = INTRO + HERO;
        var redFrom = portalFrom + PORTAL;
        var quoteFrom = redFrom + RED;
        var gated = !(WR.portal && WR.portal.unlocked);

        /* until the glass is broken, nothing past the portal exists: if the
           scroll carried past it, put it back */
        if (gated && screens > redFrom) {
          holdScrollAt(redFrom);
          screens = redFrom;
        }

        var darkPortal = runPortal(seg(screens, portalFrom, redFrom), screens > portalFrom && (gated || screens <= redFrom));
        var darkRed = runRed(seg(screens, redFrom, quoteFrom), (screens > redFrom && screens <= quoteFrom && !gated) || redForced);
        runQuote(seg(screens, quoteFrom, TOTAL), screens > quoteFrom && !gated);
        document.documentElement.classList.toggle('is-dark', !!(darkPortal || darkRed));

        /* the score follows the story */
        if (redForced || (!gated && screens > redFrom && screens <= quoteFrom)) setMood('red');
        else if (gated && screens > portalFrom) setMood('tension', 0.2 + 0.35 * seg(screens, portalFrom, redFrom));
        else setMood('calm');
      }
    });
  }

  /* ======================================================================
     THE QUOTE

     The red room overexposes to white from its centre; out of that white
     the line resolves — blurred, loosely spaced and a little large at first,
     tightening into focus.

       0.00 - 0.12   pure white, a breath
       0.12 - 0.55   the line resolves
       0.55 - 1.00   it holds, then the waitlist scrolls up under it
     ====================================================================== */

  var quoteStage = document.getElementById('quote');

  function releaseDark() {
    document.documentElement.classList.remove('is-dark');
    setMood('calm');
  }

  /* the soundtrack's mood, sent only when it changes */
  var moodKey = '';
  function setMood(name, amount) {
    var a = amount == null ? 1 : Math.round(amount * 20) / 20;
    var key = name + a;
    if (key === moodKey || !WR.setMood) return;
    moodKey = key;
    WR.setMood(name, a);
  }

  function writeQuote(q) {
    if (!quoteStage) return;
    var v = q.toFixed(3);
    if (quoteStage._q === v) return;
    quoteStage._q = v;
    quoteStage.style.setProperty('--quote', v);
  }

  /* ---- the portal ------------------------------------------------------
     The hero's last frame sinks into black under the scroll; the page stops
     for a breath while it shatters (portal.js), and resumes in the red
     room. */
  var redForced = false;           /* the room shows under the burst, before scrolling */

  function holdScrollAt(screens) {
    if (!pinST) return;
    var y = pinST.start + (pinST.end - pinST.start) * (screens / TOTAL);
    if (smoother) {
      smoother.scrollTop(y);
      smoother.paused(true);
    } else {
      window.scrollTo(0, y);
      document.documentElement.classList.add('is-locked');
    }
  }

  function initPortal() {
    var P = WR.portal;
    if (!P) return;
    P.onLock = function () { holdScrollAt(INTRO + HERO + PORTAL); };
    P.onBurst = function () {
      initShards();
      redForced = true;
      runRed(0, true);
      document.documentElement.classList.add('is-dark');
      if (WR.award) WR.award('portal', 150);
    };
    P.onOpen = function () {
      if (smoother) smoother.paused(false);
      document.documentElement.classList.remove('is-locked');
      if (stage) stage.classList.remove('in-portal');
      /* "But," arrives on its own, then the scroll takes over */
      gsap.to(redCopy, { but: 1, duration: 1.1, ease: 'power2.out', onUpdate: function () { runRed(redLast, true); } });
      setTimeout(function () { redForced = false; }, 50);
    };
  }

  function runPortal(p, on) {
    if (!WR.portal) return false;
    WR.portal.update(p, on);
    /* under full black the rest of the stage can go; once opened, passing
       back through just shows the hero */
    if (stage) stage.classList.toggle('in-portal', on && WR.portal.dark >= 1 && !WR.portal.unlocked);
    return on && WR.portal.dark > 0.5;
  }

  /* ---- the red room ------------------------------------------------------ */
  var shardsCanvas = document.getElementById('shards');
  var redBut = document.getElementById('red-but');
  var redLine = document.getElementById('red-line');
  var redCopy = { but: 0 };
  var redLast = 0;
  var SHARD_AWARDS = [0.14, 0.29, 0.44, 0.6, 0.75, 0.9];

  function initShards() {
    if (!WR.shards || !shardsCanvas || reduced) return;
    WR.shards.init(shardsCanvas);
  }

  function runRed(p, on) {
    if (!WR.shards || !shardsCanvas) return false;
    redLast = p;
    if (on) initShards();
    var sp = seg(p, 0.2, 0.95);
    /* the room overexposes to white for the quote */
    WR.shards.update(sp, on, { white: seg(p, 0.9, 1), black: 0 });
    if (stage) stage.classList.toggle('in-red', on);
    if (!on) {
      /* scrolling back up into the hero: the words go with the room */
      setStyle(redBut, 'opacity', '0');
      setStyle(redLine, 'opacity', '0');
    }
    if (on) {
      setStyle(redBut, 'opacity', (redCopy.but * (1 - seg(p, 0.06, 0.1))).toFixed(3));
      setStyle(redLine, 'opacity', (seg(p, 0.1, 0.14) * (1 - seg(p, 0.24, 0.28))).toFixed(3));
      setStyle(redLine, 'transform', 'translate(-50%, calc(-50% + ' + ((1 - seg(p, 0.1, 0.15)) * 3).toFixed(2) + 'vh))');
      for (var i = 0; i < SHARD_AWARDS.length; i++) {
        if (sp >= SHARD_AWARDS[i] && WR.award) WR.award('shard' + i, 25);
      }
    }
    return on && p < 0.93;
  }

  function runQuote(p, on) {
    if (!quoteStage) return;
    quoteStage.classList.toggle('is-on', on);
    if (stage) stage.classList.toggle('in-quote', on);
    if (!on) return;
    /* eased out, so the last of the focus arrives gently */
    var q = seg(p, 0.12, 0.55);
    q = 1 - Math.pow(1 - q, 3);
    writeQuote(q);
    if (q > 0.9 && WR.award) WR.award('quote', 100);
  }

  /* Without motion there is no glass: the room's words and numbers are set
     as a still page instead, so nobody misses them. */
  function initRedStill() {
    if (!reduced || !WR.shards || !WR.shards.stats) return;
    var host = document.createElement('section');
    host.className = 'red-still';
    host.setAttribute('aria-hidden', 'true');      /* the sr-only list already reads these */
    var html = '<p class="red-still-but">But,</p>' +
      '<p class="red-line red-still-line"><span class="t-sm">That\u2019s</span><span class="t-lg"><span class="cap">B</span>ullsh*t</span></p>' +
      '<ul class="red-still-stats">';
    WR.shards.stats.forEach(function (s) {
      var words = s.lines.map(function (ln) { return ln[0] === 'sm' ? ln[1] : ln[1] + ln[2]; }).join(' ');
      html += '<li><span class="rs-big">' + s.big + '<span class="rs-unit">' + s.unit + '</span></span>' +
        '<span class="rs-words">' + words + '</span><span class="rs-source">' + s.source + '</span></li>';
    });
    host.innerHTML = html + '</ul>';
    document.getElementById('act-one').insertAdjacentElement('afterend', host);
  }

  function initQuote() {
    if (!quoteStage) return;
    if (reduced) {
      var host = document.createElement('section');
      host.className = 'quote-still';
      var after = document.querySelector('.red-still') || document.getElementById('act-one');
      after.insertAdjacentElement('afterend', host);
      host.appendChild(quoteStage);
      quoteStage.classList.add('is-on');
      writeQuote(1);
      return;
    }
    writeQuote(0);
  }

  /* ======================================================================
     PAGE-WIDE: ruler, anchors, waitlist
     ====================================================================== */

  function initRuler() {
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: function (self) { if (WR.progress) WR.progress(self.progress); }
    });
  }

  function initAnchors() {
    document.querySelectorAll('[data-scroll-to]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var target = document.querySelector(a.getAttribute('data-scroll-to'));
        if (!target) return;
        e.preventDefault();
        if (smoother) smoother.scrollTo(target, true, 'top top');
        else target.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function initWaitlist() {
    var form = document.getElementById('waitlist');
    var note = document.getElementById('waitlist-note');
    if (!form) return;
    var input = form.querySelector('input');
    var button = form.querySelector('button');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = (input.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        form.classList.add('is-error');
        if (note) note.textContent = 'That doesn’t look like an email address.';
        input.focus();
        return;
      }
      form.classList.remove('is-error');
      form.classList.add('is-joined');
      input.disabled = true;
      button.disabled = true;
      button.textContent = 'You’re on the list';
      if (note) note.textContent = 'Thanks. We’ll write once, when it’s ready.';
      if (WR.award) WR.award('join', 250);
      if (WR.chime) WR.chime();
    });

    input.addEventListener('input', function () {
      if (form.classList.contains('is-error')) {
        form.classList.remove('is-error');
        if (note) note.textContent = 'No spam. One email when it’s ready.';
      }
    });
  }

  /* ======================================================================
     ARRIVAL
     ====================================================================== */

  var chrome = ['.sound', '.ruler', '#xp', '.dock'];

  function hideForArrival() {
    if (reduced) return;
    gsap.set(chrome, { autoAlpha: 0 });
    gsap.set('#title .t-sm, #title .t-lg', { autoAlpha: 0, y: 40 });
    gsap.set('#hint', { autoAlpha: 0 });
  }

  function arrive() {
    if (reduced) return;
    var tl = gsap.timeline({ defaults: { ease: 'expo.out', clearProps: 'transform,opacity,visibility,filter' } });
    tl.fromTo('#title .t-lg', { autoAlpha: 0, y: 60, filter: 'blur(14px)' },
              { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1.8 }, 0.1)
      .fromTo('#title .t-sm', { autoAlpha: 0, y: 40, filter: 'blur(10px)' },
              { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1.6 }, 0.35)
      .fromTo('.dock', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2, clearProps: 'opacity,visibility' }, 0.6)
      .fromTo(['.sound', '#xp'], { autoAlpha: 0, y: -14 }, { autoAlpha: 1, y: 0, duration: 1 }, 0.75)
      .fromTo('.ruler', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, clearProps: 'opacity,visibility' }, 0.9)
      .fromTo('#hint', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1 }, 1.4);
    return tl;
  }

  /* ======================================================================
     BOOT → GATE → SITE
     ====================================================================== */

  var siteReady = false;
  var entered = false;

  function framesIn() {
    measured = function () {
      siteReady = true;
      WR.gateReady();
    };
    if (!measureInWorker()) measureFrom(0);
  }

  /* ---- measuring off the main thread ---------------------------------------
     Reading 300 frames back pixel by pixel on the main thread was what froze
     the loader at 99 and stuttered the frost. Here every frame is shrunk to
     160x90 by createImageBitmap (off-thread) and handed to a worker that
     scans it on an OffscreenCanvas, so the page never waits on it. */
  function measureInWorker() {
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap || !window.Blob) return false;
    var src = [
      'var cv = new OffscreenCanvas(160, 90), cx = cv.getContext("2d", { willReadFrequently: true });',
      'onmessage = function (e) {',
      '  var BANDS = e.data.bands, PW = 160, PH = 90, CUT = 24;',
      '  cx.clearRect(0, 0, PW, PH); cx.drawImage(e.data.bmp, 0, 0, PW, PH); e.data.bmp.close();',
      '  var d = cx.getImageData(0, 0, PW, PH).data, band = [];',
      '  for (var bi = 0; bi < BANDS; bi++) {',
      '    var y0 = Math.floor(bi * PH / BANDS), y1 = Math.floor((bi + 1) * PH / BANDS), lo = 1, hi = 0;',
      '    for (var y = y0; y < y1; y++) for (var x = 0; x < PW; x++)',
      '      if (d[(y * PW + x) * 4 + 3] > CUT) { var f = x / PW; if (f < lo) lo = f; if (f > hi) hi = f; }',
      '    band[bi] = hi > lo ? { l: lo, r: hi } : null;',
      '  }',
      '  postMessage({ i: e.data.i, band: band });',
      '};'
    ].join('\n');
    var worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    } catch (err) { return false; }

    var next = 0, done = 0, LANES = 6, failed = false;
    worker.onmessage = function (e) {
      bounds[e.data.i] = e.data.band;
      done++;
      WR.gateProgress(0.9 + 0.1 * (done / FRAMES));
      if (done >= FRAMES) finish();
      else pump();
    };
    worker.onerror = function () { if (!failed) { failed = true; worker.terminate(); measureFrom(0); } };

    function pump() {
      if (failed || next >= FRAMES) return;
      var i = next++;
      var img = images[i];
      if (!img || !img.naturalWidth) { done++; if (done >= FRAMES) finish(); else pump(); return; }
      createImageBitmap(img, { resizeWidth: 160, resizeHeight: 90, resizeQuality: 'low' }).then(function (bmp) {
        worker.postMessage({ i: i, bmp: bmp, bands: BAND_COUNT }, [bmp]);
      }, function () { done++; if (done >= FRAMES) finish(); else pump(); });
    }
    function finish() {
      worker.terminate();
      painted = -1;
      fitBeats();
      draw();
      if (measured) { var cb = measured; measured = null; cb(); }
    }
    for (var k = 0; k < LANES; k++) pump();
    return true;
  }

  function enter() {
    if (entered) return;
    entered = true;
    if (smoother) smoother.scrollTop(0); else window.scrollTo(0, 0);
    snow.alpha = 1;
    document.documentElement.classList.remove('is-booting');
    ScrollTrigger.refresh();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        WR.gateLeave(function () { if (WR.award) WR.award('enter', 100); });
        setTimeout(arrive, 350);
        setTimeout(function () {
          /* compile the red room's shaders now, not on first scroll into it */
          var warm = function () { initShards(); if (WR.portal) WR.portal.prepare(); };
          if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 3000 });
          else warm();
        }, 2400);
      });
    });
  }

  var started = false;

  function start() {
    if (started) return;
    started = true;
    hideForArrival();
    initFilm();
    initRedStill();
    initQuote();
    initRuler();
    initAnchors();
    initWaitlist();
    WR.onGateEnter(enter);
    initPortal();
    ScrollTrigger.refresh();

    /* never let a stalled image hold the gate closed */
    setTimeout(function () { if (!siteReady) { siteReady = true; WR.gateReady(); } }, 12000);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      sizeCanvas();
      draw();
      ScrollTrigger.refresh();
    }, 140);
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start);
    setTimeout(start, 1600);
  } else {
    start();
  }
})();
