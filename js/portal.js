/* ==========================================================================
   WE RISE — portal.js

   The way into the red room, at the end of the hero.

     Bleed   · scrolling on past the hero's last frame, the picture burns to
               red: shadows crush to black first, the black climbs through
               the midtones, and the brightest shapes glow red longest,
               until there is nothing left.
     Black   · the page stops for a breath.
     Break   · the black splits into angular chunks. A jagged hole tears
               open in the middle, and the pieces fall away from you,
               scattering toward the edges.
               Scrolling resumes in the red room.

   A 2D canvas over the stage. app.js drives it with update(p, on), pauses
   the scroll on onLock, shows the room on onBurst and hands the scroll back
   on onOpen.
   ========================================================================== */

(function () {
  'use strict';

  var WR = window.WR = window.WR || {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.getElementById('portal');
  if (!canvas) { WR.portal = { update: function () {}, prepare: function () {}, unlocked: true, dark: 0 }; return; }

  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;
  /* the canvas multiplies onto the stage: white leaves the hero as it is,
     red stains it and keeps its detail, black is black */
  canvas.style.mixBlendMode = 'multiply';

  /* idle → bleeding → held → breaking → open */
  var state = 'idle';
  var bleed = 0;              /* 0..1 of the portal stretch of scroll */
  var heldFor = 0;
  var brk = 0;                /* 0..1 */
  var last = 0, running = false;

  var HOLD = reduced ? 0 : 0.55;
  var BREAK = reduced ? 0.3 : 1.35;

  var portal = WR.portal = {
    unlocked: false,
    dark: 0,
    onLock: null,
    onBurst: null,
    onOpen: null,
    update: update,
    prepare: prepare
  };

  function smooth(x, a, b) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* ---- sizing ------------------------------------------------------------ */
  function size() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W;
    canvas.height = H;
    makePieces();
    source = null;
  }
  window.addEventListener('resize', function () { if (W) size(); });

  /* ======================================================================
     THE BLEED
     The hero's last frame, read once at low resolution as light plus a
     slow noise. Every frame a stain is built from it and multiplied over
     the stage: it turns the picture crimson, then a threshold climbs
     through it, black beneath. Drawn small and stretched up, so the shapes
     stay soft.
     ====================================================================== */

  var SW = 320, SH = 180;
  var small = document.createElement('canvas');
  var sctx = small.getContext('2d', { willReadFrequently: true });
  var source = null, out = null;

  function readSource() {
    var film = WR.heroCanvas;
    if (!film || !film.width || !W) return false;
    SW = 320;
    SH = Math.max(90, Math.round(SW * H / W));
    small.width = SW; small.height = SH;

    /* the stage's own light (120% x 95% at 50% 36%), then the figure */
    sctx.fillStyle = '#cfe4da';
    sctx.fillRect(0, 0, SW, SH);
    sctx.save();
    sctx.translate(SW * 0.5, SH * 0.36);
    sctx.scale(SW * 1.2, SH * 0.95);
    var g = sctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.34, '#f6faf8');
    g.addColorStop(0.72, '#e2efe9');
    g.addColorStop(1, '#cfe4da');
    sctx.fillStyle = g;
    sctx.fillRect(-1, -1, 2, 2);
    sctx.restore();
    sctx.drawImage(film, 0, 0, SW, SH);

    var px = sctx.getImageData(0, 0, SW, SH).data;
    var n = SW * SH;
    var lum = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
    }

    /* a slow noise, so the dark does not arrive evenly: a few octaves of
       random values, stretched and summed */
    var noise = new Float32Array(n);
    [[80, 0.62], [34, 0.38]].forEach(function (o) {
      var gw = Math.ceil(SW / o[0]) + 2, gh = Math.ceil(SH / o[0]) + 2;
      var grid = new Float32Array(gw * gh);
      for (var k = 0; k < grid.length; k++) grid[k] = Math.random();
      for (var y = 0; y < SH; y++) {
        var fy = y / o[0], y0 = Math.floor(fy), ty = fy - y0;
        ty = ty * ty * (3 - 2 * ty);
        for (var x = 0; x < SW; x++) {
          var fx = x / o[0], x0 = Math.floor(fx), tx = fx - x0;
          tx = tx * tx * (3 - 2 * tx);
          var a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
          var c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
          noise[y * SW + x] += ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * o[1];
        }
      }
    });

    /* what the threshold climbs through: mostly the picture's own light,
       loosened by the noise. The white of the stage sits high, so it lasts. */
    var level = new Float32Array(n);
    for (var j = 0; j < n; j++) level[j] = lum[j] * 0.5 + noise[j] * 0.5;

    source = { lum: lum, level: level };
    out = sctx.createImageData(SW, SH);
    return true;
  }

  function drawBleed() {
    ctx.clearRect(0, 0, W, H);
    var p = bleed;
    if (p <= 0.001) return;
    if (!source && !readSource()) return;

    /* the crimson comes over the picture, then the black climbs */
    var stain = smooth(p, 0, 0.3);
    var th = -0.3 + smooth(p, 0.12, 1) * 1.45;
    var soft = 0.3;
    var d = out.data, lum = source.lum, level = source.level;
    for (var i = 0, n = SW * SH; i < n; i++) {
      var v = (level[i] - th) / soft;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      v = v * v * (3 - 2 * v);
      /* white (no change) → crimson, deeper where the picture was darker */
      var l = lum[i];
      var o = i * 4;
      d[o] = 255 * (1 - stain * 0.1) * v;
      d[o + 1] = 255 * (1 - stain * (0.9 - 0.04 * l)) * v;
      d[o + 2] = 255 * (1 - stain * (0.92 - 0.03 * l)) * v;
      d[o + 3] = 255;
    }
    sctx.putImageData(out, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    /* once it has all but gone, finish it cleanly */
    var k = smooth(p, 0.93, 1);
    if (k > 0.001) {
      ctx.fillStyle = 'rgba(0,0,0,' + k + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ======================================================================
     THE BREAK
     The black as a few dozen angular chunks: Voronoi cells, smaller near
     the middle so the hole tears open with a ragged edge.
     ====================================================================== */

  var pieces = [];
  function IMPACT() { return { x: W * 0.5, y: H * 0.46 }; }

  function clip(poly, nx, ny, c) {
    /* keep the side where nx*x + ny*y <= c */
    var res = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
      if (da <= 0) res.push(a);
      if ((da <= 0) !== (db <= 0)) {
        var t = da / (da - db);
        res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return res;
  }

  function makePieces() {
    pieces = [];
    var o = IMPACT();
    var m = Math.min(W, H);
    var sites = [];
    /* a tight ring of small cells round the point of impact */
    for (var i = 0; i < 9; i++) {
      var a = (i / 9) * Math.PI * 2 + Math.random() * 0.5, r = m * (0.05 + Math.random() * 0.16);
      sites.push([o.x + Math.cos(a) * r, o.y + Math.sin(a) * r]);
    }
    /* larger cells everywhere else */
    var cols = W > H ? 6 : 4, rows = W > H ? 4 : 6;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        sites.push([(x + 0.15 + Math.random() * 0.7) / cols * W, (y + 0.15 + Math.random() * 0.7) / rows * H]);
      }
    }
    var pad = 24;
    var far = Math.hypot(W, H) * 0.6;
    for (var s = 0; s < sites.length; s++) {
      var poly = [[-pad, -pad], [W + pad, -pad], [W + pad, H + pad], [-pad, H + pad]];
      for (var t = 0; t < sites.length && poly.length; t++) {
        if (t === s) continue;
        var nx = sites[t][0] - sites[s][0], ny = sites[t][1] - sites[s][1];
        var mx = (sites[t][0] + sites[s][0]) / 2, my = (sites[t][1] + sites[s][1]) / 2;
        poly = clip(poly, nx, ny, nx * mx + ny * my);
      }
      if (poly.length < 3) continue;
      var cx = 0, cy = 0;
      poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
      cx /= poly.length; cy /= poly.length;
      var dx = cx - o.x, dy = cy - o.y, d = Math.hypot(dx, dy) || 1;
      var near = 1 - Math.min(1, d / far);
      pieces.push({
        pts: poly.map(function (p) { return [p[0] - cx, p[1] - cy]; }),
        cx: cx, cy: cy, dx: dx / d, dy: dy / d,
        /* the middle goes first; a few far pieces loosen early, opening slivers */
        delay: (1 - near) * 0.42 + Math.random() * 0.12,
        dur: 0.45 + Math.random() * 0.25,
        push: (0.08 + Math.random() * 0.22) * (0.5 + near),
        spin: (Math.random() - 0.5) * (0.6 + near * 1.6),
        shrink: 0.55 + Math.random() * 0.35,
        fall: Math.random() * 0.08
      });
    }
  }

  function drawBreak() {
    var b = brk;
    ctx.clearRect(0, 0, W, H);
    var diag = Math.hypot(W, H);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'miter';
    for (var i = 0; i < pieces.length; i++) {
      var s = pieces[i];
      var t = (b - Math.max(0, s.delay)) / s.dur;
      if (t >= 1) continue;
      var sc = 1, tx = 0, ty = 0, rot = 0;
      if (t > 0) {
        /* it falls away from you: shrinking, turning, drifting outward */
        var e = 1 - Math.pow(1 - t, 2.4);
        sc = 1 - e * s.shrink;
        tx = s.dx * e * s.push * diag;
        ty = s.dy * e * s.push * diag + e * e * s.fall * H;
        rot = s.spin * e;
        if (sc <= 0.02) continue;
      }
      ctx.save();
      ctx.translate(s.cx + tx, s.cy + ty);
      if (rot) ctx.rotate(rot);
      if (sc !== 1) ctx.scale(sc, sc);
      ctx.beginPath();
      ctx.moveTo(s.pts[0][0], s.pts[0][1]);
      for (var k = 1; k < s.pts.length; k++) ctx.lineTo(s.pts[k][0], s.pts[k][1]);
      ctx.closePath();
      ctx.fill();
      if (sc === 1) ctx.stroke();       /* seal the seams while it is whole */
      ctx.restore();
    }
  }

  /* ======================================================================
     LOOP AND FLOW
     ====================================================================== */

  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    if (state === 'bleeding') {
      drawBleed();
    } else if (state === 'held') {
      heldFor += dt;
      if (heldFor >= HOLD) breakOpen();
    } else if (state === 'breaking') {
      brk = Math.min(1, brk + dt / BREAK);
      drawBreak();
      if (brk >= 1) finish();
    }

    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function prepare() {
    if (!W) size();
  }

  /* the portal stretch of the scroll, p 0..1 */
  function update(p, on) {
    if (portal.unlocked) {
      /* after the room has opened, scrolling back up simply passes through */
      canvas.classList.remove('is-on');
      portal.dark = 0;
      return;
    }
    if (state === 'held' || state === 'breaking') return;
    if (on) {
      if (!W) size();
      if (state === 'idle') {
        state = 'bleeding';
        source = null;              /* read the hero as it is now */
        canvas.classList.add('is-on');
        start();
      }
      bleed = p;
      portal.dark = smooth(p, 0.35, 0.7);
      /* all black: the page stops here, for a breath */
      if (p >= 0.98) lock();
    } else if (state === 'bleeding') {
      canvas.classList.remove('is-on');
      state = 'idle';
      running = false;
      bleed = 0;
      portal.dark = 0;
      ctx.clearRect(0, 0, W, H);
    }
  }

  function lock() {
    state = 'held';
    heldFor = 0;
    portal.dark = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (WR.heartbeat) WR.heartbeat();
    if (portal.onLock) portal.onLock();
  }

  function breakOpen() {
    state = 'breaking';
    brk = 0;
    if (WR.shatter) WR.shatter();
    if (WR.setMood) WR.setMood('red');
    if (portal.onBurst) portal.onBurst();
  }

  function finish() {
    state = 'open';
    running = false;
    portal.unlocked = true;
    portal.dark = 0;
    ctx.clearRect(0, 0, W, H);
    canvas.classList.remove('is-on');
    if (portal.onOpen) portal.onOpen();
  }
})();
