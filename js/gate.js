/* ==========================================================================
   WE RISE — gate.js

   The way in, in three moves:

     Loading  · the ice is already there, dim. A frost front travels down
                the screen as the counter climbs — the texture's highlights
                flare white along the front, and below it is still only a
                smooth teal field. At 100 the whole pane is ice.
     Waiting  · a hand under the ice follows the pointer. "Draw a circle."
     Drawing  · press and drag, and the stroke is carved through the
                frost behind the pointer: a clear channel, a bright ragged
                rim, a glowing head. Close one loop and the ice whites out,
                +100 XP, and the site opens.

   Assets, both optional — the gate falls back to drawing its own:
     assets/gate/ice.jpg    a photograph of ice, graded to the page's teal
     assets/gate/hand.png   a hand on transparency, finger pointing up;
                            the fingertip is found automatically

   API on window.WR: gateProgress(0..1) · gateReady() · onGateEnter(fn) ·
   gateLeave(onXP)
   ========================================================================== */

(function () {
  'use strict';

  var WR = window.WR = window.WR || {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var gate = document.getElementById('gate');
  if (!gate) {
    var enterFn = null;
    WR.gateProgress = function () {};
    WR.gateReady = function () { if (enterFn) enterFn(); };
    WR.onGateEnter = function (fn) { enterFn = fn; };
    WR.gateLeave = function (cb) { if (cb) cb(); };
    return;
  }

  /* an optional ice photograph: <div id="gate" data-ice="assets/gate/ice.jpg"> */
  var ICE_SRC = (document.getElementById('gate') || { dataset: {} }).dataset.ice || '';
  var HAND_PNG = 'assets/gate/hand.png';
  var HAND_SVG = 'assets/gate/hand.svg';

  var label = document.getElementById('gate-label');
  var sub = document.getElementById('gate-sub');
  var counter = document.getElementById('gate-count');
  var reward = document.getElementById('gate-reward');
  var rewardN = document.getElementById('gate-reward-n');
  var glCv = document.getElementById('gate-gl');

  /* loading → settling → ready ⇄ drawing → done */
  var state = 'loading';
  var enterCb = null;

  /* ======================================================================
     SHADERS
     ====================================================================== */

  var COMMON = [
    'precision highp float;',
    'float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }',
    'vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));',
    '  vec2 u = f*f*(3.-2.*f);',
    '  return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;',
    '}',
    'float fbm(vec2 p){ float v = 0., a = .5; for(int i=0;i<5;i++){ v += a*noise(p); p = p*2.03 + 17.1; a *= .5; } return v; }',
    ''
  ].join('\n');

  /* The fallback ice, drawn once into a texture when there is no photograph.
     Cellular cracks are the expensive part, so they are never per-frame. */
  var BAKE = COMMON + [
    'uniform vec2 uRes;',
    'float crack(vec2 p){',
    '  vec2 n = floor(p), f = fract(p); float d1 = 8., d2 = 8.;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){',
    '    vec2 g = vec2(float(i), float(j)); vec2 r = g + hash2(n+g) - f; float d = dot(r,r);',
    '    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2){ d2 = d; }',
    '  }',
    '  return sqrt(d2) - sqrt(d1);',
    '}',
    'void main(){',
    '  vec2 p = (gl_FragCoord.xy - .5*uRes) / uRes.y;',
    '  float n  = fbm(p*1.5);',
    '  float fc = fbm(p*3.1 + n*1.4 + 2.);',
    '  vec3 ice = mix(vec3(.24,.49,.42), vec3(.52,.74,.66), smoothstep(.28,.72,n));',
    '  ice = mix(ice, vec3(.8,.92,.87), smoothstep(.48,.82,fc)*.72);',
    '  ice = mix(ice, vec3(.86,.95,.91), smoothstep(.6,.68,fbm(p*16. + 3.)) * .22 * smoothstep(.35,.75,fc));',
    '  vec2 w = p*2.3 + (vec2(n, fc) - .5)*.9;',
    '  float patchA = smoothstep(.42,.64, fbm(p*1.2 + 5.));',
    '  float patchB = smoothstep(.5,.72, fbm(p*2. + 11.));',
    '  float lines = smoothstep(.024,.0,crack(w))*.6*patchA + smoothstep(.016,.0,crack(p*6.2 + n*2.2))*.22*patchB;',
    '  ice = mix(ice, vec3(.86,.96,.91), lines*.55);',
    '  float sc = smoothstep(.0035,.0, abs(fract(dot(p, vec2(.94,.34))*2.2 + n*.45) - .5)) * step(.55, fbm(p*2.1 + 9.));',
    '  ice = mix(ice, vec3(.92,.98,.95), sc*.28);',
    '  gl_FragColor = vec4(ice, 1.);',
    '}'
  ].join('\n');

  var FRAG = COMMON + [
    'uniform vec2 uRes;',
    'uniform float uTime, uWhite, uLoad, uSettle, uHand, uAng, uHandH, uHandAspect, uHandMode;',
    'uniform float uStroke, uHeadA, uHeadR, uGlow, uIceAspect, uIceFlip, uGrade, uMotion;',
    'uniform vec2 uVel;',
    'uniform vec2 uTip, uHead, uTipUV;',
    'uniform sampler2D uHandTex, uMask, uIce, uCount;',
    'uniform float uCountA;',
    '',
    'vec3 iceAt(vec2 uv){',
    '  vec2 c = uv - .5;',
    '  float sa = uRes.x / uRes.y;',
    '  if (sa > uIceAspect) c.y *= uIceAspect / sa; else c.x *= sa / uIceAspect;',
    '  vec2 t = c + .5;',
    '  if (uIceFlip > .5) t.y = 1. - t.y;',
    '  vec3 raw = texture2D(uIce, t).rgb;',
    /* grade any photograph onto the page's teal, keeping its light */
    '  float l = dot(raw, vec3(.299,.587,.114));',
    '  vec3 graded = mix(vec3(.15,.38,.32), vec3(.62,.8,.73), smoothstep(.08,.7,l));',
    '  graded = mix(graded, vec3(.9,.98,.95), smoothstep(.62,.95,l));',
    '  return mix(raw, graded, uGrade);',
    '}',
    '',
    'void main(){',
    '  vec2 frag = gl_FragCoord.xy;',
    '  vec2 px = 1. / uRes;',
    '  vec2 uv = frag * px;',
    '  vec2 p = (frag - .5*uRes) / uRes.y;',
    '  float t = uTime;',
    '  float nz = noise(p*3.) * .6 + noise(p*7.3 + 4.) * .4;',
    '',
    '  vec3 ice = iceAt(uv);',
    '  float lum = dot(ice, vec3(.299,.587,.114));',
    '',
    /* ---- loading: the frost front ---- */
    '  vec3 field = mix(vec3(.22,.5,.43), vec3(.74,.9,.84), smoothstep(.35,-.6,p.y));',
    '  field = mix(field, vec3(.66,.86,.79), smoothstep(.95,.0,length(p - vec2(0.,-.6)))*.35);',
    '  float edgeY = mix(.64, -.95, uLoad);',
    '  float rag = (noise(vec2(p.x*2.4, t*.06))*.55 + noise(vec2(p.x*6.5, t*.1 + 3.))*.3 + noise(p*18.)*.15 - .5)*.36;',
    '  float y = p.y + rag;',
    '  float cover = smoothstep(edgeY - .04, edgeY + .1, y);',
    /* along the front the highlights flare to white, a band that trails up */
    '  float band = smoothstep(edgeY - .04, edgeY + .08, y) * (1. - smoothstep(edgeY + .06, edgeY + .6, y));',
    '  float th = smoothstep(.5, .54, lum + (nz - .5)*.18 + (noise(p*40.) - .5)*.05);',
    '  vec3 flare = mix(ice*.92, vec3(.84,.99,.91), th);',
    '  vec3 lit = mix(ice, flare, band * (1. - uSettle));',
    '  lit *= mix(.86, 1., uSettle);',
    '  float haze = smoothstep(edgeY - .45, edgeY, y) * (1. - cover);',
    '  vec3 col = mix(field, field*.9 + .04, haze*.5);',
    '  col = mix(col, lit, cover);',
    /* the counter lives under the ice: sharp on the open field, and once the
       frost has passed over it, still there — bent and softened through it */
    '  if (uCountA > .001) {',
    '    vec2 cuv = vec2(uv.x, 1. - uv.y);',
    '    float sharp = texture2D(uCount, cuv).a;',
    '    vec2 ro = ((vec2(nz, noise(p*5. + 2.)) - .5) * .022 + vec2(lum - .5, .5 - lum) * .008) * cover;',
    '    vec2 bo = px * (2. + 6.*cover);',
    '    float soft = texture2D(uCount, cuv + ro).a*.36',
    '      + texture2D(uCount, cuv + ro + vec2(bo.x, 0.)).a*.16 + texture2D(uCount, cuv + ro - vec2(bo.x, 0.)).a*.16',
    '      + texture2D(uCount, cuv + ro + vec2(0., bo.y)).a*.16 + texture2D(uCount, cuv + ro - vec2(0., bo.y)).a*.16;',
    '    float na = mix(sharp, soft*.9, cover) * uCountA;',
    '    col = mix(col, mix(vec3(1.), vec3(.9,.98,.95) + (lum - .5)*.2, cover), na);',
    '  }',
    '',
    /* ---- the hand, under the ice ----------------------------------------
       It lives behind the pane, so everything about it is decided by the
       glass: the ice's own relief bends it (a normal taken from the
       texture's light), frost scatters it (a disc blur that widens where
       the ice is milky), and the ice's light and cracks sit on top of it.
       Movement stirs the glass — the bend deepens, a slow ripple runs
       through it and the image smears along the motion — then settles. */
    '  if (uHand > .001) {',
    '  vec3 iceX = iceAt(uv + vec2(px.x*3., 0.));',
    '  vec3 iceY = iceAt(uv + vec2(0., px.y*3.));',
    '  vec2 nrm = vec2(dot(iceX - ice, vec3(.333)), dot(iceY - ice, vec3(.333)));',
    '  float frost = smoothstep(.32, .86, lum);',
    '  vec2 wob = (vec2(noise(p*8. + t*2.1), noise(p*8. - t*2.1 + 7.)) - .5) * uMotion * .035;',
    '  vec2 q = p + nrm * (.12 + uMotion*.45) + wob + (vec2(nz, noise(p*2.2 + 9.)) - .5) * .012;',
    '  vec2 v = q - uTip;',
    '  float ca = cos(uAng), sa = sin(uAng);',
    '  vec2 hl = vec2(dot(v, vec2(ca, -sa)), dot(v, vec2(sa, ca)));',
    '  vec2 huv = vec2(uTipUV.x + hl.x/(uHandH*uHandAspect), uTipUV.y - hl.y/uHandH);',
    '  float inside = step(-.02, huv.x)*step(huv.x, 1.02)*step(-.02, huv.y)*step(huv.y, 1.02);',
    '  float rad = .0015 + frost*.0045 + uMotion*.007;',
    '  vec2 smear = vec2(-uVel.x, uVel.y) * uMotion * .018;',
    '  float ha = 0.; vec3 hsum = vec3(0.);',
    '  for (int k = 0; k < 8; k++) {',
    '    float fk = float(k);',
    '    float an = fk*2.39996 + t*.3;',
    '    vec2 off = vec2(cos(an), sin(an)) * rad * sqrt((fk + .5)/8.) + smear * (fk/7.);',
    '    vec4 h = texture2D(uHandTex, huv + off);',
    '    ha += h.a; hsum += h.rgb * h.a;',
    '  }',
    '  vec3 hc = hsum / max(ha, .001);',
    '  ha = ha / 8. * inside;',
    /* light the hand throws into the frost around it */
    '  float gw = 0.;',
    '  for (int k = 0; k < 6; k++) {',
    '    float an = float(k)*1.0472 + .5;',
    '    gw += texture2D(uHandTex, huv + vec2(cos(an), sin(an)) * .035).a;',
    '  }',
    '  gw = gw / 6. * inside;',
    '  if (uHandMode < .5) {',
    '    float tL = clamp(hc.r + (nz - .5)*.3, 0., 1.);',
    '    vec3 th2 = mix(vec3(.4,.8,.9), vec3(.24,.64,.33), smoothstep(.12,.42,tL));',
    '    th2 = mix(th2, vec3(.66,.88,.3), smoothstep(.48,.74,tL));',
    '    hc = mix(th2, vec3(.93,.97,.55), smoothstep(.86,1.,tL));',
    '  }',
    /* through the pane: veiled by frost, the ice's light and cracks on top */
    '  hc = mix(hc, ice, .12 + .24*frost);',
    '  hc += (lum - .45) * .2;',
    '  hc = mix(hc, vec3(.9,.98,.95), smoothstep(.7,.95,lum) * .4);',
    '  hc += (noise(p*120.) - .5) * .02;',
    '  float hm = smoothstep(.1, .55, ha) * uHand;',
    '  col = mix(col, mix(col, vec3(.55,.9,.78), .45), gw * (1. - hm) * .3 * uHand);',
    '  col = mix(col, hc, hm);',
    '  }',
    '',
    /* ---- the stroke, carved through the frost ---- */
    '  if (uStroke > .001) {',
    '  vec2 suv = vec2(frag.x, uRes.y - frag.y) * px;',
    '  vec2 jit = (vec2(noise(p*40.), noise(p*40. + 5.1)) - .5) * 7. * px;',
    '  float m = texture2D(uMask, suv + jit).r;',
    '  float g = (texture2D(uMask, suv + vec2(16.,0.)*px).r + texture2D(uMask, suv - vec2(16.,0.)*px).r',
    '           + texture2D(uMask, suv + vec2(0.,16.)*px).r + texture2D(uMask, suv - vec2(0.,16.)*px).r) * .25;',
    '  float g2 = (texture2D(uMask, suv + vec2(38.,0.)*px).r + texture2D(uMask, suv - vec2(38.,0.)*px).r',
    '            + texture2D(uMask, suv + vec2(0.,38.)*px).r + texture2D(uMask, suv - vec2(0.,38.)*px).r) * .25;',
    '  float rough = (noise(p*80.) - .5)*.5 + (noise(p*22.) - .5)*.35;',
    '  float mm = m + rough*.45;',
    '  float inner = smoothstep(.6, .92, mm);',
    '  float edge = max(g, m*.5) + rough*.42 + (noise(p*140.) - .5)*.2;',
    '  float rim = smoothstep(.1, .38, edge) * (1. - smoothstep(.62, .9, mm));',
    '  vec3 clear = ice*.56 + vec3(.02,.09,.075);',
    '  col = mix(col, clear, inner * .92 * uStroke);',
    '  col = mix(col, vec3(.97,1.,.99), clamp(rim*1.35, 0., 1.) * uStroke);',
    '  col += vec3(.85,1.,.95) * (g2*.35 + g*.12) * (1. - inner) * uStroke;',
    '  }',
    '',
    '  if (uHeadA > .001) {',
    '  float hd = length(frag - uHead) / uHeadR + (noise(p*55.) - .5)*.1;',
    '  col = mix(col, vec3(1.), smoothstep(1.02, .84, hd) * uHeadA);',
    '  col += vec3(.9,1.,.96) * smoothstep(2.4, .9, hd) * .3 * uHeadA;',
    '  }',
    '',
    '  col += uGlow * .15;',
    '  col += (hash(frag + fract(t*7.)*113.) - .5) * .07;',
    '  col = mix(col, vec3(1.), uWhite);',
    '  gl_FragColor = vec4(col, 1.);',
    '}'
  ].join('\n');

  var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }';

  var gl = null, uni = {}, prog = null, bake = null, bakeRes = null;
  var handTex = null, maskTex = null, iceTex = null, fbo = null;
  var icePhoto = false, iceAspect = 1;
  var hand = { mode: 0, tipU: 0.5, tipV: 0.03, aspect: 0.5, height: 1.02 };
  var SCALE = 0.8;

  function makeTex(unit, w, h) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w || 1, h || 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  function upload(unit, tex, source) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function compile(fragSrc) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    var pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs);
    gl.bindAttribLocation(pr, 0, 'a');
    gl.linkProgram(pr);
    return gl.getProgramParameter(pr, gl.LINK_STATUS) ? pr : null;
  }

  function initGL() {
    if (!glCv) return false;
    try {
      gl = glCv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    } catch (e) { gl = null; }
    if (!gl) return false;

    prog = compile(FRAG);
    bake = compile(BAKE);
    if (!prog || !bake) { gl = null; return false; }

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    ['uRes', 'uTime', 'uWhite', 'uLoad', 'uSettle', 'uHand', 'uAng', 'uHandH', 'uHandAspect',
     'uHandMode', 'uStroke', 'uHeadA', 'uHeadR', 'uGlow', 'uIceAspect', 'uIceFlip', 'uGrade',
     'uTip', 'uHead', 'uTipUV', 'uMotion', 'uVel', 'uHandTex', 'uMask', 'uIce', 'uCount', 'uCountA'].forEach(function (u) {
      uni[u] = gl.getUniformLocation(prog, u);
    });
    bakeRes = gl.getUniformLocation(bake, 'uRes');

    handTex = makeTex(0);
    maskTex = makeTex(1);
    fbo = gl.createFramebuffer();

    gl.useProgram(prog);
    gl.uniform1i(uni.uHandTex, 0);
    gl.uniform1i(uni.uMask, 1);
    gl.uniform1i(uni.uIce, 2);
    gl.uniform1i(uni.uCount, 3);
    countTex = makeTex(3);

    loadIce();
    loadHand();
    return true;
  }

  /* ---- ice: a photograph if there is one, otherwise the baked pane ---- */
  function loadIce() {
    if (!ICE_SRC) return;
    var img = new Image();
    img.onload = function () {
      if (!gl) return;
      if (iceTex) gl.deleteTexture(iceTex);
      iceTex = makeTex(2);
      upload(2, iceTex, img);
      icePhoto = true;
      iceAspect = img.naturalWidth / img.naturalHeight;
    };
    img.src = ICE_SRC;
  }

  function bakeIce(w, h) {
    if (icePhoto) return;
    if (iceTex) gl.deleteTexture(iceTex);
    iceTex = makeTex(2, w, h);
    gl.useProgram(bake);
    gl.uniform2f(bakeRes, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, iceTex, 0);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, iceTex);
    iceAspect = w / h;
  }

  /* ---- hand: the PNG if there is one, otherwise the SVG light map ---- */
  function loadHand() {
    var png = new Image();
    png.onload = function () { useHand(png, 1); };
    png.onerror = function () {
      var svg = new Image();
      svg.onload = function () { useHand(svg, 0, 512, 1024); };
      svg.src = HAND_SVG;
    };
    png.src = HAND_PNG;
  }

  function useHand(img, mode, w, h) {
    var iw = w || img.naturalWidth, ih = h || img.naturalHeight;
    var k = Math.min(1, 1600 / Math.max(iw, ih));
    var cw = Math.round(iw * k), ch = Math.round(ih * k);
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, cw, ch);

    /* find the fingertip: the highest opaque pixels in the picture */
    var tipU = 0.5, tipV = 0.03;
    try {
      var d = cx.getImageData(0, 0, cw, ch).data;
      search:
      for (var y = 0; y < ch; y++) {
        var sx = 0, n = 0;
        for (var x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3] > 60) { sx += x; n++; }
        if (n > 1) { tipU = sx / n / cw; tipV = y / ch; break search; }
      }
    } catch (e) {}

    upload(0, handTex, c);
    hand.mode = mode;
    hand.tipU = tipU;
    hand.tipV = tipV;
    hand.aspect = cw / ch;
    /* how tall the whole picture stands on screen, in screen heights */
    hand.height = mode ? 0.98 : 1.02;
  }

  /* ---- the counter, drawn where the DOM number used to sit ---- */
  var countTex = null;
  var countCv = document.createElement('canvas');
  var countCx = countCv.getContext('2d');
  var countShown = -1;

  function drawCount(n) {
    if (!gl || !countTex) return;
    var w = glCv.width, h = glCv.height;
    if (countCv.width !== w || countCv.height !== h) { countCv.width = w; countCv.height = h; }
    var vw = innerWidth;
    var size = Math.max(80, Math.min(160, vw * 0.11)) * SCALE;
    var left = Math.max(22.4, Math.min(44.8, vw * 0.026)) * SCALE;
    var bottom = Math.max(16, Math.min(35.2, vw * 0.022)) * SCALE;
    countCx.clearRect(0, 0, w, h);
    countCx.fillStyle = '#fff';
    countCx.textBaseline = 'alphabetic';
    countCx.font = '700 ' + Math.round(size) + 'px "Space Grotesk"';
    if ('letterSpacing' in countCx) countCx.letterSpacing = Math.round(-size * 0.06) + 'px';
    countCx.fillText(String(n), left, h - bottom - size * 0.06);
    upload(3, countTex, countCv);
    countShown = n;
  }

  function sizeGL() {
    if (!gl) return;
    var w = Math.round(innerWidth * SCALE), h = Math.round(innerHeight * SCALE);
    if (glCv.width !== w || glCv.height !== h) {
      glCv.width = w; glCv.height = h;
      bakeIce(w, h);
      gl.viewport(0, 0, w, h);
      countShown = -1;
    }
  }

  /* ======================================================================
     THE STROKE MASK
     ====================================================================== */

  var MASK_SCALE = 0.5;
  var mask = document.createElement('canvas');
  var mctx = mask.getContext('2d');
  var maskDirty = true;

  function strokeWidth() {
    return Math.max(46, Math.min(96, Math.min(innerWidth, innerHeight) * 0.078));
  }

  function sizeMask() {
    mask.width = Math.round(innerWidth * MASK_SCALE);
    mask.height = Math.round(innerHeight * MASK_SCALE);
    mctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    mctx.strokeStyle = '#fff';
    maskDirty = true;
  }

  function clearMask() {
    mctx.save();
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mask.width, mask.height);
    mctx.restore();
    maskDirty = true;
  }

  function maskSegment(a, b) {
    mctx.lineWidth = strokeWidth();
    mctx.beginPath();
    mctx.moveTo(a.x, a.y);
    mctx.lineTo(b.x, b.y);
    mctx.stroke();
    maskDirty = true;
  }

  /* ======================================================================
     MOTION AND FRAME
     ====================================================================== */

  var mouse = { x: innerWidth * 0.55, y: innerHeight * 0.45 };
  var lastMove = 0;
  var tip = { x: 0, y: -1 };
  var ang = 0;
  var head = { x: mouse.x, y: mouse.y };
  var anim = { load: 0, settle: 0, hand: 0, rise: 0, stroke: 0, headA: 0, white: 0, glow: 0, motion: 0, countA: 1 };
  var prevTip = { x: 0, y: -1 };
  var vel = { x: 0, y: 0 };
  var targetLoad = 0;
  var readyPending = false;

  function toShader(cx, cy) {
    return { x: (cx - innerWidth / 2) / innerHeight, y: (innerHeight / 2 - cy) / innerHeight };
  }

  function handScale() {
    return Math.max(0.6, Math.min(1, innerWidth / innerHeight / 1.2 + 0.25));
  }

  var last = performance.now(), time = 0, running = true, shownCount = -1, handShown = false;

  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;

    anim.load += (targetLoad - anim.load) * Math.min(1, dt * (reduced ? 20 : 2.2));
    var count = Math.min(100, Math.floor(anim.load * 100 + 0.02));
    if (count !== shownCount && counter) { shownCount = count; counter.textContent = count; }
    if (readyPending && anim.load > 0.995) { readyPending = false; settle(); }

    /* once the frost has come down, the hand rises under it, even while the
       counter is still running */
    if (!handShown && state === 'loading' && anim.load > 0.62) {
      handShown = true;
      gsap.to(anim, { hand: 1, duration: 1.1, ease: 'power1.out' });
      gsap.to(anim, { rise: 1, duration: reduced ? 0.1 : 1.8, ease: 'power3.out' });
    }

    var S = handScale();
    var idle = now - lastMove > 2800 && state !== 'drawing';
    var target = idle
      ? { x: (0.06 + 0.1 * Math.sin(time * 0.33)) * S, y: -0.1 + 0.05 * Math.sin(time * 0.52) }
      : toShader(mouse.x, mouse.y);
    var follow = state === 'drawing' ? 0.5 : 0.12;
    var k = reduced ? 1 : Math.min(1, follow * 60 * dt);
    tip.x += (target.x - tip.x) * k;
    tip.y += (target.y - tip.y) * k;

    /* the PNG already leans in from the lower right, so it only tilts a
       little toward the pointer; the drawn fallback leans more */
    var rootX = tip.x * 0.3 + (hand.mode ? 0 : 0.2) * S;
    var lean = hand.mode ? 0.45 : 1;
    var wantAng = Math.max(-0.7, Math.min(0.7, Math.atan2(tip.x - rootX, tip.y + 1.1) * lean));
    ang += (wantAng - ang) * Math.min(1, 0.08 * 60 * dt);

    head.x += (mouse.x - head.x) * Math.min(1, 0.6 * 60 * dt);
    head.y += (mouse.y - head.y) * Math.min(1, 0.6 * 60 * dt);
    anim.headA += ((state === 'drawing' ? 1 : 0) - anim.headA) * Math.min(1, dt * 10);

    /* how hard the hand is moving: stirs the glass quickly, settles slowly */
    if (dt > 0) {
      var vx = (tip.x - prevTip.x) / dt, vy = (tip.y - prevTip.y) / dt;
      prevTip.x = tip.x; prevTip.y = tip.y;
      var speed = Math.sqrt(vx * vx + vy * vy);
      var want = reduced ? 0 : Math.min(1, speed * 0.8);
      anim.motion += (want - anim.motion) * Math.min(1, dt * (want > anim.motion ? 10 : 1.4));
      var vk = Math.min(1, dt * 6);
      var inv = speed > 0.001 ? Math.min(1, speed) / speed : 0;
      vel.x += (vx * inv - vel.x) * vk;
      vel.y += (vy * inv - vel.y) * vk;
    }

    if (gl) {
      sizeGL();
      if (maskDirty) { upload(1, maskTex, mask); maskDirty = false; }
      gl.uniform2f(uni.uRes, glCv.width, glCv.height);
      gl.uniform1f(uni.uTime, time);
      gl.uniform1f(uni.uLoad, anim.load);
      gl.uniform1f(uni.uSettle, anim.settle);
      gl.uniform1f(uni.uHand, anim.hand);
      gl.uniform1f(uni.uMotion, anim.motion * anim.hand);
      gl.uniform2f(uni.uVel, vel.x, vel.y);
      gl.uniform2f(uni.uTip, tip.x, tip.y - (1 - anim.rise) * 1.2);
      gl.uniform1f(uni.uAng, ang);
      gl.uniform1f(uni.uHandH, hand.height * S);
      gl.uniform1f(uni.uHandAspect, hand.aspect);
      gl.uniform1f(uni.uHandMode, hand.mode);
      gl.uniform2f(uni.uTipUV, hand.tipU, hand.tipV);
      gl.uniform1f(uni.uIceAspect, iceAspect);
      gl.uniform1f(uni.uIceFlip, icePhoto ? 1 : 0);
      gl.uniform1f(uni.uGrade, icePhoto ? 1 : 0);
      gl.uniform1f(uni.uStroke, anim.stroke);
      gl.uniform2f(uni.uHead, head.x * SCALE, (innerHeight - head.y) * SCALE);
      gl.uniform1f(uni.uHeadR, strokeWidth() * 0.62 * SCALE);
      gl.uniform1f(uni.uHeadA, anim.headA);
      gl.uniform1f(uni.uGlow, anim.glow);
      gl.uniform1f(uni.uWhite, anim.white);
      if (anim.countA > 0.001 && count !== countShown) drawCount(count);
      gl.uniform1f(uni.uCountA, anim.countA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    requestAnimationFrame(frame);
  }

  function settle() {
    if (state !== 'loading') return;
    state = 'settling';
    gsap.timeline()
      .to(anim, { settle: 1, duration: reduced ? 0.1 : 1.4, ease: 'power2.inOut' }, 0)
      .to(anim, { countA: 0, duration: 0.9, ease: 'power2.in' }, 0.2)
      .to(anim, { hand: 1, duration: 0.8, ease: 'power1.out' }, 0.5)
      .to(anim, { rise: 1, duration: reduced ? 0.1 : 1.6, ease: 'power3.out' }, 0.5)
      .add(function () { state = 'ready'; gate.classList.add('is-ready'); }, 1.0)
      .fromTo(label, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 1.2)
      .fromTo(sub, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 1.5);
  }

  /* ======================================================================
     GESTURE

     Press and drag to draw (mouse, pen or finger); letting go before the
     loop is closed lets the channel refreeze. The loop is recognised
     wherever it is drawn, at any size and in either direction — isLoop().
     ====================================================================== */

  var stroke = null;
  var strokeMovedAt = 0;
  var fade = null;

  function begin(x, y) {
    state = 'drawing';
    gate.classList.add('is-drawing');
    if (fade) { fade.kill(); fade = null; }
    clearMask();
    anim.stroke = 1;
    stroke = {
      last: { x: x, y: y },
      pts: [{ x: x, y: y, len: 0 }]
    };
    head.x = x; head.y = y;
    maskSegment(stroke.last, { x: x + 0.1, y: y });
    strokeMovedAt = performance.now();
    if (WR.startSound) WR.startSound();
  }

  function add(x, y) {
    var s = stroke;
    var pt = { x: x, y: y };
    maskSegment(s.last, pt);
    s.last = pt;
    strokeMovedAt = performance.now();

    var prev = s.pts[s.pts.length - 1];
    var dist = Math.sqrt((x - prev.x) * (x - prev.x) + (y - prev.y) * (y - prev.y));
    if (dist < 10) return;
    s.pts.push({ x: x, y: y, len: prev.len + dist });
    if (s.pts.length > 400) s.pts.splice(0, 100);
    if (isLoop(s.pts)) close();
  }

  /* A loop, not merely a curvy path. The pointer has come back near a point
     it passed a while ago, and the stretch in between:
       · is a decent size and not a sliver
       · encloses a real area (a circle fills ~79% of its box, a scribble little)
       · winds once around its own centre, steadily in one direction — a
         zig-zag sweeps back and forth, so its winding cancels
       · keeps its centre off the path itself
     Tested against wobbly, shaky, elliptical, fast and small circles (all
     pass) and zig-zags, sweeps and half-circles (all rejected). */
  function isLoop(pts) {
    var n = pts.length - 1, cur = pts[n];
    for (var j = n - 1; j >= 0; j--) {
      var pj = pts[j];
      if (cur.len - pj.len < 240) continue;

      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      var area = 0, cx = 0, cy = 0, cnt = 0, i, q;
      for (i = j; i <= n; i++) {
        q = pts[i];
        if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
        var r = i < n ? pts[i + 1] : pts[j];
        area += q.x * r.y - r.x * q.y;
        cx += q.x; cy += q.y; cnt++;
      }
      cx /= cnt; cy /= cnt;
      var w = maxX - minX, h = maxY - minY, size = Math.max(w, h);
      if (size < 80 || Math.min(w, h) < size / 3.2) continue;
      var gap = Math.sqrt((cur.x - pj.x) * (cur.x - pj.x) + (cur.y - pj.y) * (cur.y - pj.y));
      if (gap > Math.max(40, size * 0.2)) continue;
      if (Math.abs(area) / 2 / (w * h) < 0.6) continue;

      var net = 0, abs = 0, minR = Infinity, prevA = null;
      for (i = j; i <= n; i++) {
        q = pts[i];
        var dx = q.x - cx, dy = q.y - cy;
        var rr = Math.sqrt(dx * dx + dy * dy);
        if (rr < minR) minR = rr;
        var ang = Math.atan2(dy, dx);
        if (prevA !== null) {
          var d = ang - prevA;
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          net += d; abs += Math.abs(d);
        }
        prevA = ang;
      }
      var turns = Math.abs(net) / (Math.PI * 2);
      if (turns < 0.85 || turns > 1.3) continue;
      if (abs > Math.abs(net) * 1.12) continue;
      if (minR < size * 0.18) continue;
      return true;
    }
    return false;
  }

  function end() {
    if (state !== 'drawing') return;
    state = 'ready';
    stroke = null;
    gate.classList.remove('is-drawing');
    fade = gsap.to(anim, { stroke: 0, duration: 0.7, ease: 'power2.in', onComplete: function () { clearMask(); fade = null; } });
  }

  window.addEventListener('pointermove', function (e) {
    mouse.x = e.clientX; mouse.y = e.clientY;
    lastMove = performance.now();
    if (state !== 'drawing' || !stroke || !pressed) return;
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];
    for (var i = 0; i < evs.length && state === 'drawing'; i++) add(evs[i].clientX, evs[i].clientY);
  }, { passive: true });

  var pressed = false;
  gate.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (WR.startSound) WR.startSound();
    if (state !== 'ready') return;
    pressed = true;
    try { gate.setPointerCapture(e.pointerId); } catch (err) {}
    mouse.x = e.clientX; mouse.y = e.clientY;
    begin(e.clientX, e.clientY);
  });
  function release() {
    if (!pressed) return;
    pressed = false;
    end();
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);

  /* ======================================================================
     CLOSING THE LOOP
     ====================================================================== */

  var entered = false;
  function fireEnter() {
    if (entered) return;
    entered = true;
    if (enterCb) enterCb();
  }

  function close() {
    if (state === 'done') return;
    state = 'done';
    stroke = null;
    gate.classList.remove('is-drawing');
    gate.classList.add('is-closed');
    if (WR.startSound) WR.startSound();
    if (WR.chime) WR.chime();

    var n = { v: 0 };
    gsap.timeline()
      .to(anim, { glow: 1, headA: 0, duration: 0.35, ease: 'power2.out' }, 0)
      .to(anim, {
        white: 1, duration: reduced ? 0.2 : 0.95, ease: 'power2.inOut',
        onUpdate: function () { gate.style.setProperty('--white', anim.white.toFixed(3)); }
      }, 0.12)
      .add(function () { gate.classList.add('is-reward'); }, reduced ? 0.25 : 0.8)
      .fromTo(reward, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.7, ease: 'back.out(1.8)' }, reduced ? 0.3 : 0.9)
      .to(n, { v: 100, duration: 0.9, ease: 'power2.out', onUpdate: function () { if (rewardN) rewardN.textContent = Math.round(n.v); } }, '<0.1')
      .add(fireEnter, '+=0.35');

    /* belt and braces: never leave anyone standing at the gate */
    setTimeout(fireEnter, 3200);
  }

  WR.gateLeave = function (onXP) {
    var pill = document.getElementById('xp');
    var paid = false;
    function pay() { if (!paid) { paid = true; if (onXP) onXP(); } }
    function finish() { running = false; if (gate.parentNode) gate.remove(); }

    var tl = gsap.timeline({ onComplete: finish });
    if (pill && reward && !reduced) {
      var star = reward.querySelector('.gr-gem');
      var a = star.getBoundingClientRect();
      var b = pill.getBoundingClientRect();
      tl.to(star, {
        x: b.left + 22 - (a.left + a.width / 2),
        y: b.top + b.height / 2 - (a.top + a.height / 2),
        scale: 0.2, duration: 0.85, ease: 'power3.inOut'
      }, 0)
        .to(reward.querySelector('.gr-xp'), { autoAlpha: 0, y: -10, duration: 0.35 }, 0)
        .add(pay, 0.8)
        .to(gate, { autoAlpha: 0, duration: 0.9, ease: 'power2.out' }, 0.45);
    } else {
      pay();
      tl.to(gate, { autoAlpha: 0, duration: 0.5 });
    }
    setTimeout(function () { pay(); gate.style.opacity = 0; gate.style.pointerEvents = 'none'; setTimeout(finish, 600); }, 2600);
  };

  /* ======================================================================
     API
     ====================================================================== */

  WR.gateProgress = function (frac) {
    targetLoad = Math.max(targetLoad, Math.min(0.99, frac));
  };

  WR.gateReady = function () {
    targetLoad = 1;
    readyPending = true;
  };

  WR.onGateEnter = function (fn) { enterCb = fn; };

  window.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && (state === 'ready' || state === 'drawing')) {
      e.preventDefault();
      close();
    }
  });

  /* ---- go ---- */
  if (!initGL()) gate.classList.add('no-gl');
  sizeGL();
  sizeMask();
  window.addEventListener('resize', function () { sizeGL(); sizeMask(); });
  gsap.set([label, sub], { autoAlpha: 0 });
  requestAnimationFrame(frame);
})();
