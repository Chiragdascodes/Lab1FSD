/* ==========================================================================
   WE RISE — shards.js

   The red room. A moving red scene — light pillars drifting, a hand reaching
   up out of the dark, film grain — seen through broken panes of glass that
   carry the numbers. One WebGL canvas:

     1 · the scene is drawn into a texture (half resolution; it is soft)
     2 · the texture is drawn to the screen with grain
     3 · every pane is a 3D slab of glass: a front face and the walls of its
         thickness, projected and drawn far to near. The face's shader knows
         the exact distance to its own edge, so it reads as a real sheet:
         clear, bending the scene, splitting bright light into a rainbow,
         crushed crystal along the break. The walls catch the light as the
         pane turns. Six carry the numbers and stay turned toward you; the
         rest is debris, most of it far behind and out of focus.
         The text is set into a fixed rectangle the outline is built around,
         so it can never be cut off.

   Driven from app.js: WR.shards.update(progress, on, { white, black }).
   ========================================================================== */

(function () {
  'use strict';

  var WR = window.WR = window.WR || {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var HAND_SRC = 'assets/gate/hand.png';

  /* ---- the words: real, published findings, each with its source ---- */
  var STATS = [
    { big: '43', unit: '%', lines: [['sm', 'of what you do each day'], ['sm', 'is a'], ['script', 'H', 'abit'], ['sm', 'not a decision']],
      source: 'Wood, Quinn & Kashy · 2002' },
    { big: '66', unit: 'days', lines: [['sm', 'to make a habit'], ['script', 'A', 'utomatic'], ['sm', 'not twenty-one']],
      source: 'Lally et al. · UCL · 2010' },
    { big: '47', unit: '%', lines: [['sm', 'of waking hours'], ['sm', 'your'], ['script', 'M', 'ind'], ['sm', 'is somewhere else']],
      source: 'Killingsworth & Gilbert · 2010' },
    { big: '23', unit: 'min', lines: [['sm', 'to get back on track'], ['sm', 'after a single'], ['script', 'I', 'nterruption']],
      source: 'Mark, Gudith & Klocke · 2008' },
    { big: '40', unit: '%', lines: [['sm', 'of productive time'], ['sm', 'lost to'], ['script', 'S', 'witching']],
      source: 'Rubinstein, Meyer & Evans · 2001' },
    { big: '20', unit: '%', lines: [['sm', 'of adults are'], ['sm', 'chronic'], ['script', 'P', 'rocrastinators']],
      source: 'Ferrari et al. · 2005' }
  ];

  /* the rectangle on each pane the words live in, in world units */
  var TW = 0.74, TH = 0.41;

  /* ======================================================================
     SHADERS
     ====================================================================== */

  var NOISE = [
    'float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));',
    '  vec2 u = f*f*(3.-2.*f);',
    '  return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;',
    '}',
    'float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a*noise(p); p = p*2.07 + 13.1; a *= .5; } return v; }',
    'vec3 hue(float h){ return clamp(abs(fract(h + vec3(0.,.333,.667))*6. - 3.) - 1., 0., 1.); }'
  ].join('\n');

  var QUAD_VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }';

  var SCENE_FS = [
    'precision highp float;',
    NOISE,
    'uniform vec2 uRes, uMouse;',
    'uniform float uTime, uRise, uHandOn, uHandAspect;',
    'uniform vec2 uHandTip;',
    'uniform sampler2D uHand;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 p = (gl_FragCoord.xy - .5*uRes) / uRes.y;',
    '  float t = uTime;',
    '  vec3 col = mix(vec3(.26,.0,.02), vec3(.8,.03,.05), smoothstep(1.3,.05,length(p*vec2(.75,1.))));',
    '  col *= mix(.7, 1., smoothstep(-.65,.15,p.y));',
    /* tall pale pillars of light, drifting and breathing, like stage lamps
       through a curtain */
    '  float beams = 0.;',
    '  for (int i = 0; i < 6; i++) {',
    '    float fi = float(i);',
    '    float x = fract(.08 + fi*.173 + sin(t*.045 + fi*1.7)*.035);',
    '    float w = .012 + .028*fract(fi*.37 + .2);',
    '    float b = exp(-pow((uv.x - x)/w, 2.)) * (.5 + .5*sin(t*.3 + fi*2.3));',
    '    beams += b * (.3 + .7*smoothstep(-.1,1.,uv.y + (noise(vec2(fi*9., t*.12)) - .5)*.4));',
    '  }',
    '  beams += smoothstep(.5,1.,noise(vec2(uv.x*18., t*.07))) * .22;',
    '  col += vec3(1.,.36,.33) * beams * .3;',
    /* flame: tall tongues of red light licking upward, fastest at the bottom */
    '  vec2 fq = vec2(uv.x*5.5, uv.y*1.4 - t*.78);',
    '  float warp = fbm(fq*1.3 + vec2(0., -t*.4));',
    '  float fl = fbm(vec2(fq.x + warp*1.4, fq.y*1.2 + warp*.8));',
    '  float tongues = smoothstep(.42, .82, fl) * (1. - smoothstep(.1, 1.05, uv.y));',
    '  float embers = smoothstep(.62, .95, fbm(vec2(uv.x*14., uv.y*3. - t*1.6)));',
    '  col += vec3(1.,.2,.1) * tongues * .55 + vec3(1.,.45,.3) * embers * tongues * .35;',
    '  col += vec3(.55,.02,.02) * smoothstep(.3,.9, fbm(vec2(uv.x*3., uv.y*.8 - t*.34))) * .25;',
    /* the hand, reaching up out of the dark */
    '  float sway = sin(t*.35)*.035 + sin(t*.21 + 1.3)*.02;',
    '  vec2 tip = vec2(.04 + sin(t*.23)*.02, mix(-.02, .2, uRise) + sin(t*.4)*.012);',
    '  vec2 v = p - tip;',
    '  float cs = cos(sway), sn = sin(sway);',
    '  v = vec2(cs*v.x - sn*v.y, sn*v.x + cs*v.y);',
    /* narrow screens: a smaller hand, so it still reads as a hand */
    '  float H = 1.3 * clamp(uRes.x/uRes.y/1.2 + .3, .55, 1.);',
    '  vec2 huv = vec2(uHandTip.x + v.x/(H*uHandAspect), uHandTip.y - v.y/H);',
    '  float ins = step(0.,huv.x)*step(huv.x,1.)*step(0.,huv.y)*step(huv.y,1.);',
    '  vec4 h = texture2D(uHand, huv) * .4 + texture2D(uHand, huv + vec2(.003,.002)) * .3 + texture2D(uHand, huv - vec2(.003,.002)) * .3;',
    '  float l = dot(h.rgb, vec3(.33));',
    '  vec3 skin = mix(vec3(.25,.0,.01), vec3(1.,.5,.38), smoothstep(.25,.95,l));',
    '  skin = mix(skin, vec3(1.,.74,.6), smoothstep(.85,1.,l)*.55);',
    '  col = mix(col, skin, h.a * ins * uHandOn * .94);',
    '  float md = length(p - uMouse);',
    '  col += vec3(1.,.08,.06) * exp(-md*md*30.) * .6;',
    '  col = mix(col, col*.22, smoothstep(.55,1.2,length(p*vec2(.6,1.))));',
    '  gl_FragColor = vec4(col, 1.);',
    '}'
  ].join('\n');

  var SHOW_FS = [
    'precision highp float;',
    NOISE,
    'uniform vec2 uRes;',
    'uniform float uTime, uWhite, uBlack;',
    'uniform sampler2D uScene;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec3 col = texture2D(uScene, uv).rgb;',
    '  col += (hash(gl_FragCoord.xy + fract(uTime*7.)*97.) - .5) * .12;',
    '  col = mix(col, vec3(0.), uBlack);',
    /* overexposure spreading from the centre, with a warm edge as it goes */
    '  float rr = length((gl_FragCoord.xy - .5*uRes) / uRes.y);',
    '  float wf = clamp(uWhite*2.2 - rr*1.1, 0., 1.);',
    '  col += vec3(1.,.55,.45) * smoothstep(0., .5, wf) * (1. - wf) * .8;',
    '  col = mix(col, vec3(1.), smoothstep(.2, 1., wf));',
    '  gl_FragColor = vec4(col, 1.);',
    '}'
  ].join('\n');

  var PANE_VS = [
    'attribute vec2 aPos;',     /* clip space, already projected */
    'attribute vec2 aLocal;',   /* this point on the pane, world units */
    'attribute vec2 aA;',       /* the rim edge this triangle belongs to */
    'attribute vec2 aB;',
    'attribute float aBev;',    /* whether that edge is bevelled */
    'varying vec2 vLocal, vA, vB;',
    'varying float vBev;',
    'void main(){ vLocal = aLocal; vA = aA; vB = aB; vBev = aBev; gl_Position = vec4(aPos, 0., 1.); }'
  ].join('\n');

  var PANE_FS = [
    '#extension GL_OES_standard_derivatives : enable',
    'precision highp float;',
    NOISE,
    'varying vec2 vLocal, vA, vB;',
    'varying float vBev;',
    'uniform vec2 uRes, uTilt, uTextSize;',
    'uniform float uTime, uBlur, uAlpha, uHasText, uSeed, uWhite, uBlack;',
    'uniform sampler2D uScene, uText;',
    '',
    'vec3 sceneAt(vec2 uv){ return texture2D(uScene, clamp(uv, vec2(.001), vec2(.999))).rgb; }',
    '',
    'vec3 finish(vec3 col){',
    '  col = mix(col, vec3(0.), uBlack);',
    '  float rr = length((gl_FragCoord.xy - .5*uRes) / uRes.y);',
    '  float wf = clamp(uWhite*2.2 - rr*1.1, 0., 1.);',
    '  col += vec3(1.,.55,.45) * smoothstep(0., .5, wf) * (1. - wf) * .8;',
    '  return mix(col, vec3(1.), smoothstep(.2, 1., wf));',
    '}',
    '',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 L = vLocal;',
    '  vec2 e = vB - vA;',
    '  float el = max(length(e), 1e-5);',
    '  vec2 ed = e / el;',
    '  vec2 inward = vec2(-ed.y, ed.x);',
    '  float along = dot(L - vA, ed);',
    /* how squarely this edge faces the light, as the pane turns */
    '  float lightA = .5 + .5*dot(-inward, normalize(vec2(-.55, .84) + uTilt*5.));',
    '',
    /* ---- the wall of the slab: the thickness of the glass, seen edge-on.
       Bright, a little prismatic, never dark. ---- */
    '  if (vBev > 1.5) {',
    '    float grain = noise(vec2(along*140., uSeed)) * .6 + noise(vec2(along*30., uSeed + 4.)) * .4;',
    '    vec3 behind = sceneAt(uv + uTilt*1.2);',
    '    vec3 wc = behind*.8 + vec3(1.,.96,.96)*(.14 + .5*lightA*lightA) + grain*.1;',
    '    wc += hue(along*2.5 + uSeed) * .06;',
    '    float wa = uAlpha * (.92 - uBlur*.5);',
    '    gl_FragColor = vec4(finish(wc) * wa, wa);',
    '    return;',
    '  }',
    '',
    /* ---- the face ---- */
    '  float d0 = abs(e.x*(L.y - vA.y) - e.y*(L.x - vA.x)) / el;',
    /* a broken edge: a fine ripple and here and there a shallow bite */
    '  float rough = (noise(vec2(along*60., uSeed)) - .5)*.006 + (noise(vec2(along*210., uSeed + 3.)) - .5)*.003;',
    '  float chip = smoothstep(.62, .86, noise(vec2(along*22., uSeed*1.7)));',
    '  float d = d0 + (rough - chip*.009)*vBev;',
    '  float aa = max(fwidth(d0), 1e-4) * (1. + uBlur*14.);',
    '',
    /* the bevel of crushed glass along the break, its width wandering */
    '  float bw = .014 + .014*noise(vec2(along*4., uSeed + 9.));',
    '  float bev = 1. - smoothstep(bw*.3, bw, d);',
    '  float slope = bev*bev;',
    '',
    /* what is behind, bent: a gentle warp across the sheet, the tilt, and a
       hard pull through the bevel, each colour bent by its own amount */
    '  vec2 warp = (vec2(noise(L*1.7 + uSeed), noise(L*1.7 + uSeed + 5.)) - .5) * .032;',
    '  vec2 off = uTilt*1.1 + warp + inward * slope * vec2(.05*uRes.y/uRes.x, .05);',
    '  vec2 cab = normalize(off + 1e-4) * (.004 + slope*.02);',
    '  vec3 refr = vec3(sceneAt(uv + off + cab).r, sceneAt(uv + off*1.05).g, sceneAt(uv + off*1.1 - cab).b);',
    '  if (uBlur > .01) {',
    '    vec2 b1 = vec2(.018, .012) * uBlur, b2 = vec2(-.014, .02) * uBlur;',
    '    refr = refr*.28 + (sceneAt(uv + off + b1) + sceneAt(uv + off - b1) + sceneAt(uv + off + b2) + sceneAt(uv + off - b2)) * .18;',
    '  }',
    '  float lum = dot(refr, vec3(.299,.587,.114));',
    '',
    /* clear glass: a breath brighter and cooler than what is behind it */
    '  vec3 col = mix(refr, vec3(lum), .1) * 1.05 + vec3(.055,.05,.058);',
    '',
    /* reflections: a soft gradient of sky and two streaks that slide with the turn */
    '  float s1 = dot(L, normalize(vec2(.8, .6))) + uTilt.x*6. - uTilt.y*4.;',
    '  col += smoothstep(.4, -.3, s1) * .045;',
    '  col += smoothstep(.1, 0., abs(s1 - .2)) * .13 + smoothstep(.028, 0., abs(s1 + .27)) * .09;',
    '',
    /* bright light through thick glass fans out into a spectrum */
    '  float spec = smoothstep(.42, .85, lum);',
    '  col += hue(L.x*.9 - L.y*1.4 + uTilt.x*6. + uSeed) * spec * (.22 + slope*.4);',
    '',
    /* crushed crystal in the bevel: facets, each catching the light its own way */
    '  vec2 g = vec2(along * 90., d * 150.);',
    '  vec2 gi = floor(vec2(g.x + noise(g*.3 + uSeed)*1.2, g.y));',
    '  float h1 = hash(gi + uSeed), h2 = hash(gi + uSeed + 7.3);',
    '  vec2 gf = fract(g) - .5;',
    '  float seam = smoothstep(.34, .5, max(abs(gf.x + gf.y*.5), abs(gf.y)));',
    '  vec3 facet = col * (.96 + .34*h1) + vec3(1.,.97,.97) * pow(h2, 3.) * .6 * (.35 + .65*lightA);',
    '  facet += hue(h1*1.7 + uSeed) * step(.82, h2) * .14 + seam * .1;',
    '  col = mix(col, facet, bev * vBev * (1. - uBlur*.7));',
    '  col += bev * (1. - vBev) * .07;',
    '',
    /* the rim: a bright hairline at the break, the back edge a ghost inside
       it, and the whole sheet brightening a little toward its edges */
    '  float rim = 1. - smoothstep(0., aa*1.8, d);',
    '  col += rim * (.4 + .5*lightA) * (1. - uBlur*.7);',
    '  col += (1. - smoothstep(0., aa*2., abs(d - bw))) * .1 * (1. - uBlur);',
    '  col += (1. - smoothstep(0., .14, d)) * .045;',
    '',
    /* the words, white and clean, set into the glass */
    '  if (uHasText > .5) {',
    '    vec2 tuv = vec2(L.x/uTextSize.x + .5, .5 - L.y/uTextSize.y);',
    '    float inT = step(0., tuv.x)*step(tuv.x, 1.)*step(0., tuv.y)*step(tuv.y, 1.);',
    '    float ta = texture2D(uText, tuv).a * inT;',
    '    float glow = (texture2D(uText, tuv + vec2(.005,0.)).a + texture2D(uText, tuv - vec2(.005,0.)).a',
    '               + texture2D(uText, tuv + vec2(0.,.009)).a + texture2D(uText, tuv - vec2(0.,.009)).a) * .25 * inT;',
    /* bright light behind the words is held to a soft pink, so white reads on it */
    '    float near = (texture2D(uText, tuv + vec2(.02,0.)).a + texture2D(uText, tuv - vec2(.02,0.)).a',
    '               + texture2D(uText, tuv + vec2(0.,.04)).a + texture2D(uText, tuv - vec2(0.,.04)).a + glow*2.) / 6. * inT;',
    '    col = mix(col, min(col, vec3(.78,.5,.48)), smoothstep(0., .35, near));',
    '    col += vec3(1.,.95,.95) * glow * .12;',
    '    col = mix(col, vec3(1.), ta);',
    '  }',
    '',
    '  col += (hash(gl_FragCoord.xy + fract(uTime*7.)*53.) - .5) * .05;',
    '  float alpha = smoothstep(0., aa, d) * uAlpha;',
    '  gl_FragColor = vec4(finish(col) * alpha, alpha);',
    '}'
  ].join('\n');

  /* ======================================================================
     PANES
     ====================================================================== */

  function seeded(seed) {
    var s = (seed * 9301 + 49297) % 233280;
    return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  /* A broken pane of glass is never a rectangle, but it only needs to be as
     big as its words. Each text pane hugs its text: every corner sits just
     outside it, pushed out by its own uneven amount so no two edges run
     parallel; one edge breaks out into a short sharp point, and often one
     corner is knocked off. Every point is outside the text, so the words
     always fit. */
  function textOutline(r, hw, hh) {
    function push(lo, hi) { return lo + r() * (hi - lo); }
    /* corners, counter-clockwise from bottom-left, each out on both axes */
    var corners = [
      [-hw - push(0.03, 0.08), -hh - push(0.03, 0.07)],
      [hw + push(0.03, 0.08), -hh - push(0.03, 0.07)],
      [hw + push(0.03, 0.08), hh + push(0.03, 0.07)],
      [-hw - push(0.03, 0.08), hh + push(0.03, 0.07)]
    ];
    var spikeEdge = Math.floor(r() * 4);
    var cutCorner = r() < 0.65 ? (spikeEdge + 2 + Math.floor(r() * 2)) % 4 : -1;
    var pts = [];
    for (var i = 0; i < 4; i++) {
      var c = corners[i], nx = corners[(i + 1) % 4];
      if (i === cutCorner) {
        /* knock the corner off: two points, each still outside the text */
        var sx = c[0] > 0 ? 1 : -1, sy = c[1] > 0 ? 1 : -1;
        /* never deeper than the corner stands out, or it would cut the text */
        var cut = (Math.abs(c[0]) - hw + Math.abs(c[1]) - hh) * push(0.45, 0.85);
        if (i % 2 === 0) { pts.push([c[0], c[1] - sy * cut]); pts.push([c[0] - sx * cut, c[1]]); }
        else { pts.push([c[0] - sx * cut, c[1]]); pts.push([c[0], c[1] - sy * cut]); }
      } else {
        pts.push(c);
      }
      if (i === spikeEdge) {
        /* a short sharp point breaking out of this edge */
        var t = push(0.25, 0.75);
        var mx = c[0] + (nx[0] - c[0]) * t, my = c[1] + (nx[1] - c[1]) * t;
        var ex = nx[0] - c[0], ey = nx[1] - c[1], el = Math.hypot(ex, ey);
        var ox = ey / el, oy = -ex / el;                 /* outward */
        var reach = push(0.08, 0.16);
        pts.push([mx + ox * reach, my + oy * reach]);
      }
    }
    return pts;
  }

  function outline(seed, kind, w, h, text) {
    var r = seeded(seed), pts;
    if (text) {
      pts = textOutline(r, w / 2 + 0.02, h / 2 + 0.02);
    } else {
      /* debris: small slabs, parallelograms and triangles */
      var hw2 = w / 2, hh2 = h / 2, kind2 = r();
      var j = function () { return (r() - 0.5) * 0.18; };
      if (kind2 < 0.4) {
        var sk = (r() - 0.5) * 0.9;
        pts = [[-1 + j(), -1 + j()], [1 + j(), -1 + sk + j()], [1 + j(), 1 + sk + j()], [-1 + j(), 1 + j()]];
      } else if (kind2 < 0.75) {
        pts = [[-1 + j(), -0.9 + j()], [1 + j(), -1 + j()], [(r() - 0.5) * 1.2, 1 + j()]];
      } else {
        pts = [[-1 + j(), -1 + j()], [0.8 + j(), -1 + j()], [1 + j(), 0.3 + j()], [0.2 + j(), 1 + j()], [-0.9 + j(), 0.7 + j()]];
      }
      pts = pts.map(function (q) { return [q[0] * hw2, q[1] * hh2]; });
    }
    pts.sort(function (a, b) { return Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]); });
    if (text) pts = torn(pts, r);
    return pts.map(function (p) { return [p[0], p[1], r() > 0.25 ? 1 : 0]; });
  }

  /* Glass never breaks along a ruled line: step each long edge with a small
     notch or two, mostly outward so the words stay inside. */
  function torn(pts, r) {
    var res = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      res.push(a);
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.3) continue;
      var nx = dy / len, ny = -dx / len;         /* outward, for this winding */
      var steps = len > 0.7 ? 2 : 1;
      for (var s = 1; s <= steps; s++) {
        var t = s / (steps + 1) + (r() - 0.5) * 0.18;
        var o = -0.004 + r() * 0.03;
        res.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
      }
    }
    return res;
  }

  var panes = [];

  function makePanes() {
    panes = [];
    /* x/yo: where it crosses mid-screen. r?0: its angle when most readable.
       r?A: how far it turns over its journey, entering tipped one way and
       leaving tipped the other. xd: sideways drift. */
    /* where each crosses, and how it is set: its roll (the words roll with
       it), and a lean in depth that shows off the thickness of the glass */
    var LAY = [
      { x: -0.02, roll: 0.16, rx: 0.2, ry: 0.18 },
      { x: -0.12, roll: 0.08, rx: 0.24, ry: -0.2 },
      { x: 0.16, roll: 0.2, rx: -0.18, ry: 0.22 },
      { x: -0.1, roll: -0.12, rx: 0.22, ry: 0.16 },
      { x: 0.02, roll: 0.3, rx: -0.2, ry: -0.24 },
      { x: 0.12, roll: -0.34, rx: 0.2, ry: 0.2 }
    ];
    for (var i = 0; i < STATS.length; i++) {
      var sd = i % 2 ? -1 : 1, L = LAY[i];
      var st0 = -0.03 + i * 0.152;
      var tp = {
        text: true, stat: i, kind: i, x: L.x, yo: 0, xd: -sd * 0.07,
        win: [st0, st0 + 0.34], z: i % 2 ? 0.95 : 1.0,
        rx0: L.rx, ry0: L.ry, rz0: L.roll,
        rxA: -sd * 0.38, ryA: sd * 0.5, rzA: sd * 0.14,
        pts: outline(31 + i * 17, i, TW, TH, true), seed: i * 3.7 + 1.1,
        blur: 0, thick: 0.06
      };
      panes.push(tp);
      /* some break with a loose piece beside them, travelling along */
      if (i === 1 || i === 4) {
        var cr = seeded(700 + i);
        var cw = 0.2 + cr() * 0.08, ch = cw * (0.55 + cr() * 0.3);
        panes.push({
          text: false, x: L.x + sd * 0.14, yo: -0.3, xd: tp.xd,
          win: [st0 + 0.012, st0 + 0.352], z: tp.z - 0.04, lingerText: true,
          rx0: -L.rx * 0.8, ry0: -L.ry, rz0: L.roll + sd * 0.5,
          rxA: sd * 0.45, ryA: -sd * 0.55, rzA: -sd * 0.2,
          pts: outline(800 + i * 7, 0, cw, ch, false), seed: i * 5.3 + 2.2,
          blur: 0, thick: 0.055
        });
      }
    }

    var r = seeded(97);
    function debris(k, zMin, zMax, wMin, wMax, xMin, xMax, blurFor) {
      var z = zMin + r() * (zMax - zMin);
      var st = r() * 1.05 - 0.2;
      var w = wMin + r() * (wMax - wMin);
      var h = w * (0.45 + r() * 0.75);
      var side = r() < 0.5 ? -1 : 1;
      panes.push({
        text: false, x: side * (xMin + r() * (xMax - xMin)), yo: (r() - 0.5) * 0.8, xd: (r() - 0.5) * 0.3,
        win: [st, st + 0.5 + r() * 0.4], z: z,
        rx0: r() * 6.28, ry0: r() * 6.28, rz0: r() * 6.28,
        /* debris turns slowly over, each piece at its own rate */
        rxA: (r() - 0.5) * 3.2, ryA: (r() - 0.5) * 3.2, rzA: (r() - 0.5) * 1.6,
        pts: outline(300 + k * 13, 0, w, h, false), seed: k * 1.9 + 5,
        blur: blurFor(z), thick: w * 0.09
      });
    }
    var k = 0;
    /* far behind, soft: most of the room's glass */
    for (var f = 0; f < 20; f++, k++) debris(k, 1.7, 3.6, 0.12, 0.3, 0.45, 1.9, function (z) { return Math.min(1, (z - 1.4) * 0.5); });
    /* a few crisp chips, just behind the numbers */
    for (var m = 0; m < 5; m++, k++) debris(k, 1.12, 1.35, 0.07, 0.15, 0.5, 1.3, function () { return 0; });
    /* and a few big slabs right in front of the lens, out of focus */
    for (var n2 = 0; n2 < 4; n2++, k++) debris(k, 0.5, 0.62, 0.45, 0.72, 0.85, 1.35, function () { return 1; });
  }

  /* ---- words onto a canvas the proportions of the text rectangle ---- */
  function textTexture(stat) {
    var c = document.createElement('canvas');
    c.width = 2048; c.height = Math.round(2048 * TH / TW);
    var x = c.getContext('2d');
    var S = c.width / 1024;                /* author at 1024 wide, draw at 2048 */
    x.scale(S, S);
    x.fillStyle = '#fff';
    x.shadowColor = 'rgba(255,245,245,0.35)';
    x.shadowBlur = 6;
    x.textBaseline = 'alphabetic';
    var H = c.height / S;                  /* ~576 */

    var left = 30, base = H * 0.74;
    x.font = '400 360px "Instrument Serif"';
    var bigW = x.measureText(stat.big).width;
    x.fillText(stat.big, left, base);

    var unitW = 0, pct = stat.unit === '%';
    if (stat.unit) {
      x.font = pct ? '400 160px "Instrument Serif"' : 'italic 400 96px "Instrument Serif"';
      unitW = x.measureText(stat.unit).width;
      x.fillText(stat.unit, left + bigW + (pct ? 4 : 12), pct ? base - 166 : base);
    }
    var bx = left + bigW + unitW + (pct ? 16 : 30);

    function lineW(ln) {
      if (ln[0] === 'sm') { x.font = 'italic 400 80px "Instrument Serif"'; return x.measureText(ln[1]).width; }
      x.font = '400 180px "Pinyon Script"';
      var cw = x.measureText(ln[1]).width;
      x.font = '400 136px "Instrument Serif"';
      return cw * 0.86 + x.measureText(ln[2]).width;
    }
    var blockW = 0, blockH = 0;
    stat.lines.forEach(function (ln) {
      blockW = Math.max(blockW, lineW(ln));
      blockH += ln[0] === 'sm' ? 80 : 178;
    });
    var k = Math.min(1, (1014 - bx) / Math.max(1, blockW), (base - 16) / Math.max(1, blockH));

    x.save();
    x.translate(bx, base - blockH * k + 50 * k);
    x.scale(k, k);
    var y = 0;
    stat.lines.forEach(function (ln) {
      if (ln[0] === 'sm') {
        x.font = 'italic 400 80px "Instrument Serif"';
        x.fillText(ln[1], 0, y);
        y += 80;
      } else {
        y += 92;
        x.font = '400 180px "Pinyon Script"';
        x.fillText(ln[1], -6, y + 8);
        var cw = x.measureText(ln[1]).width;
        x.font = '400 136px "Instrument Serif"';
        x.fillText(ln[2], -6 + cw * 0.86, y);
        y += 86;
      }
    });
    x.restore();

    x.shadowBlur = 0;
    x.globalAlpha = 0.66;
    x.font = '600 18px "Space Grotesk"';
    if ('letterSpacing' in x) x.letterSpacing = '3px';
    x.fillText(stat.source.toUpperCase(), left + 18, H - 22);
    return c;
  }

  /* ======================================================================
     GL
     ====================================================================== */

  var canvas, gl, progScene, progShow, progPane;
  var U = {}, A = {};
  var fbo, sceneTex, handTex, quadBuf, paneBuf;
  var hand = { on: 0, tipU: 0.44, tipV: 0.03, aspect: 0.96 };
  var W = 0, H = 0, SW = 0, SH = 0;
  var active = false, progress = 0, running = false;
  var fx = { white: 0, black: 0 };
  var time = 0, last = 0;
  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };

  function compile(vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  }

  function uniforms(prog, names) {
    var o = {};
    names.forEach(function (n) { o[n] = gl.getUniformLocation(prog, n); });
    return o;
  }

  function tex(w, h) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w || 1, h || 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  function init(cv) {
    if (gl) return true;
    canvas = cv;
    if (!canvas) return false;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
    if (!gl) return false;
    gl.getExtension('OES_standard_derivatives');

    progScene = compile(QUAD_VS, SCENE_FS);
    progShow = compile(QUAD_VS, SHOW_FS);
    progPane = compile(PANE_VS, PANE_FS);
    if (!progScene || !progShow || !progPane) { gl = null; return false; }

    U.scene = uniforms(progScene, ['uRes', 'uMouse', 'uTime', 'uRise', 'uHandOn', 'uHandAspect', 'uHandTip', 'uHand']);
    U.show = uniforms(progShow, ['uRes', 'uTime', 'uWhite', 'uBlack', 'uScene']);
    U.pane = uniforms(progPane, ['uRes', 'uTilt', 'uTextSize', 'uTime', 'uBlur', 'uAlpha', 'uHasText', 'uSeed',
                                 'uWhite', 'uBlack', 'uScene', 'uText']);
    ['aPos', 'aLocal', 'aA', 'aB', 'aBev'].forEach(function (n) { A[n] = gl.getAttribLocation(progPane, n); });

    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    paneBuf = gl.createBuffer();
    fbo = gl.createFramebuffer();

    handTex = tex();
    var img = new Image();
    img.onload = function () {
      var k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, c.width, c.height);
      try {
        var d = cx.getImageData(0, 0, c.width, c.height).data;
        for (var y = 0; y < c.height; y++) {
          var sx = 0, n = 0;
          for (var x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 60) { sx += x; n++; }
          if (n > 1) { hand.tipU = sx / n / c.width; hand.tipV = y / c.height; break; }
        }
      } catch (e) {}
      hand.aspect = c.width / c.height;
      gl.bindTexture(gl.TEXTURE_2D, handTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      hand.on = 1;
    };
    img.src = HAND_SRC;

    makePanes();
    var fonts = document.fonts && document.fonts.load
      ? Promise.all([
          document.fonts.load('340px "Instrument Serif"'),
          document.fonts.load('italic 64px "Instrument Serif"'),
          document.fonts.load('150px "Pinyon Script"'),
          document.fonts.load('600 19px "Space Grotesk"')
        ])
      : Promise.resolve();
    fonts.then(function () {
      panes.forEach(function (s) {
        if (!s.text) return;
        s.tex = tex();
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textTexture(STATS[s.stat]));
      });
    });

    window.addEventListener('pointermove', function (e) {
      mouse.tx = (e.clientX - innerWidth / 2) / innerHeight;
      mouse.ty = (innerHeight / 2 - e.clientY) / innerHeight;
    }, { passive: true });

    resize();
    window.addEventListener('resize', resize);
    return true;
  }

  function resize() {
    if (!gl) return;
    var dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = Math.round(canvas.clientWidth * dpr);
    H = Math.round(canvas.clientHeight * dpr);
    if (!W || !H) return;
    canvas.width = W; canvas.height = H;
    SW = Math.round(W * 0.5); SH = Math.round(H * 0.5);
    if (sceneTex) gl.deleteTexture(sceneTex);
    sceneTex = tex(SW, SH);
  }

  /* ======================================================================
     FRAME
     ====================================================================== */

  /* crosses the middle slowly and the edges quickly, so a pane lingers
     where it can be read */
  function lingering(t) {
    var s = t * 2 - 1;
    return s * (0.26 + 0.74 * s * s);
  }

  function project(s, p, aspect) {
    var t = (p - s.win[0]) / (s.win[1] - s.win[0]);
    if (t < -0.02 || t > 1.02) return null;
    t = Math.max(0, Math.min(1, t));
    /* narrow screens shrink the arrangement, but never below what can be read */
    var fit = Math.min(1, Math.max(0.6, aspect / 1.35 + 0.08));

    var sgn = t * 2 - 1;
    var like = s.text || s.lingerText;
    var cy = lingering(t) * (like ? 2.2 : 1.9) * (like ? 1 : s.z) + (s.yo || 0) * fit;
    var cx = (s.x + (s.xd || 0) * sgn) * fit + mouse.x * 0.05 / s.z;
    cy += mouse.y * 0.035 / s.z;

    /* Text panes turn most at the edges of the frame and settle as they
       cross the middle, where they are read: the turn follows sgn^3, so it
       is nearly flat at centre and steep on the way in and out. Debris just
       tumbles. */
    var ease = like ? sgn * sgn * sgn : sgn;
    var rx = s.rx0 + s.rxA * ease - mouse.y * 0.22;
    var ry = s.ry0 + s.ryA * ease + mouse.x * 0.26;
    var rz = s.rz0 + s.rzA * (s.text ? sgn : sgn) + mouse.x * 0.03;
    var czr = Math.cos(rz), szr = Math.sin(rz);
    var cxr = Math.cos(rx), sxr = Math.sin(rx);
    var cyr = Math.cos(ry), syr = Math.sin(ry);

    function place(lx, ly, lz) {
      var x = lx * fit, y = ly * fit, z = (lz || 0) * fit;
      var x1 = x * czr - y * szr, y1 = x * szr + y * czr;
      var y2 = y1 * cxr - z * sxr, z2 = y1 * sxr + z * cxr;
      var x3 = x1 * cyr + z2 * syr, z3 = -x1 * syr + z2 * cyr;
      /* panes lean in toward the camera as they cross the middle */
      var zc = s.z - (like ? 0.1 * (1 - sgn * sgn) : 0);
      var f = 1 / Math.max(0.2, zc + z3 * 0.9);
      return [(cx + x3) * f / aspect, (cy + y2) * f];
    }

    var pts = s.pts, out = [];
    /* the walls of its thickness first, so the face lies over them */
    var th = s.thick || 0;
    if (th > 0) {
      for (var w = 0; w < pts.length; w++) {
        var wa = pts[w], wb = pts[(w + 1) % pts.length];
        var fa = place(wa[0], wa[1], 0), fb = place(wb[0], wb[1], 0);
        var ba = place(wa[0], wa[1], th), bb = place(wb[0], wb[1], th);
        out.push(fa[0], fa[1], wa[0], wa[1], wa[0], wa[1], wb[0], wb[1], 2);
        out.push(fb[0], fb[1], wb[0], wb[1], wa[0], wa[1], wb[0], wb[1], 2);
        out.push(bb[0], bb[1], wb[0], wb[1], wa[0], wa[1], wb[0], wb[1], 2);
        out.push(fa[0], fa[1], wa[0], wa[1], wa[0], wa[1], wb[0], wb[1], 2);
        out.push(bb[0], bb[1], wb[0], wb[1], wa[0], wa[1], wb[0], wb[1], 2);
        out.push(ba[0], ba[1], wa[0], wa[1], wa[0], wa[1], wb[0], wb[1], 2);
      }
    }
    var c0 = place(0, 0);
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var pa = place(a[0], a[1]), pb = place(b[0], b[1]);
      var bev = a[2];
      out.push(c0[0], c0[1], 0, 0, a[0], a[1], b[0], b[1], bev);
      out.push(pa[0], pa[1], a[0], a[1], a[0], a[1], b[0], b[1], bev);
      out.push(pb[0], pb[1], b[0], b[1], a[0], a[1], b[0], b[1], bev);
    }
    s.tilt = [Math.sin(ry) * 0.06, Math.sin(rx) * 0.06];
    return new Float32Array(out);
  }

  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    time += dt;
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 3);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 3);
    draw();
    requestAnimationFrame(frame);
  }

  function quad(prog) {
    var loc = gl.getAttribLocation(prog, 'a');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return loc;
  }

  function draw() {
    if (!gl || !W) return;
    var p = progress;

    /* 1 · the scene */
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.viewport(0, 0, SW, SH);
    gl.disable(gl.BLEND);
    gl.useProgram(progScene);
    var ql = quad(progScene);
    gl.uniform2f(U.scene.uRes, SW, SH);
    gl.uniform2f(U.scene.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.scene.uTime, time);
    gl.uniform1f(U.scene.uRise, p);
    gl.uniform1f(U.scene.uHandOn, hand.on);
    gl.uniform1f(U.scene.uHandAspect, hand.aspect);
    gl.uniform2f(U.scene.uHandTip, hand.tipU, hand.tipV);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, handTex);
    gl.uniform1i(U.scene.uHand, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    /* 2 · to the screen */
    gl.viewport(0, 0, W, H);
    gl.useProgram(progShow);
    ql = quad(progShow);
    gl.uniform2f(U.show.uRes, W, H);
    gl.uniform1f(U.show.uTime, time);
    gl.uniform1f(U.show.uWhite, fx.white);
    gl.uniform1f(U.show.uBlack, fx.black);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(U.show.uScene, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(ql);

    /* 3 · the glass, far to near */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progPane);
    gl.bindBuffer(gl.ARRAY_BUFFER, paneBuf);
    var layout = [['aPos', 2, 0], ['aLocal', 2, 8], ['aA', 2, 16], ['aB', 2, 24], ['aBev', 1, 32]];
    layout.forEach(function (l) {
      if (A[l[0]] < 0) return;
      gl.enableVertexAttribArray(A[l[0]]);
      gl.vertexAttribPointer(A[l[0]], l[1], gl.FLOAT, false, 36, l[2]);
    });

    gl.uniform2f(U.pane.uRes, W, H);
    gl.uniform2f(U.pane.uTextSize, TW, TH);
    gl.uniform1f(U.pane.uTime, time);
    gl.uniform1f(U.pane.uWhite, fx.white);
    gl.uniform1f(U.pane.uBlack, fx.black);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(U.pane.uScene, 0);
    gl.uniform1i(U.pane.uText, 1);

    var aspect = W / H;
    var order = panes.slice().sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      var data = project(s, p, aspect);
      if (!data) continue;
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform2f(U.pane.uTilt, s.tilt[0], s.tilt[1]);
      gl.uniform1f(U.pane.uBlur, s.blur);
      gl.uniform1f(U.pane.uAlpha, s.text || s.lingerText ? 1 : (s.blur > 0.5 ? 0.5 : 0.78));
      gl.uniform1f(U.pane.uSeed, s.seed);
      var hasText = s.text && s.tex ? 1 : 0;
      gl.uniform1f(U.pane.uHasText, hasText);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, hasText ? s.tex : handTex);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 9);
    }
    layout.forEach(function (l) { if (A[l[0]] >= 0) gl.disableVertexAttribArray(A[l[0]]); });
    gl.disable(gl.BLEND);
  }

  /* ======================================================================
     API
     ====================================================================== */

  WR.shards = {
    stats: STATS,
    init: init,
    resize: resize,
    /* p: 0..1 through the glass; on: whether the room is showing;
       f: { white, black } fades over the whole room */
    update: function (p, on, f) {
      progress = p;
      if (f) { fx.white = f.white || 0; fx.black = f.black || 0; }
      if (on && !active) {
        active = true;
        if (canvas) canvas.classList.add('is-on');
        if (!running && gl) { running = true; last = performance.now(); requestAnimationFrame(frame); }
      } else if (!on && active) {
        active = false;
        running = false;
        if (canvas) canvas.classList.remove('is-on');
      }
      if (reduced && gl && on) draw();
    }
  };
})();
