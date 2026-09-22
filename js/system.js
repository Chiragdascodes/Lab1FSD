/* ==========================================================================
   WE RISE — system.js   (an ES module)

   The app in miniature, after the story. Each tool is built on the
   browser's own APIs, plus open web services, Three.js and Whisper:

     Where you rise    · Geolocation API finds you; the Fetch API asks
                         Open-Meteo for sunrise and weather and BigDataCloud
                         for the place name; Three.js (WebGL) draws the Earth,
                         lit by the sun where it really is now
     Speak a quest     · Web Speech API or, where that is unavailable,
                         getUserMedia + MediaRecorder + on-device Whisper for
                         speech to text; Microsoft's en-GB-RyanNeural voice
                         answers; Local Storage keeps the quests
     Focus soundscape  · Web Audio API generates rain, brown noise or alpha
                         waves live; the Canvas API draws them from an
                         AnalyserNode

   Rewards go through WR.award (ui.js), so the XP pill counts what you do here.
   ========================================================================== */

const WR = (window.WR = window.WR || {});
const root = document.getElementById('system');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js';
const HOME = { lat: 12.9716, lon: 77.5946, name: 'Bengaluru, India' };   /* shown until you share yours */

const $ = (sel) => root.querySelector(sel);
const award = (key, n) => WR.award && WR.award(key, n);

/* ======================================================================
   LOCAL STORAGE
   ====================================================================== */

const KEY = 'wr-system-v2';
const canStore = (() => {
  try { localStorage.setItem(KEY + '-probe', '1'); localStorage.removeItem(KEY + '-probe'); return true; }
  catch (e) { return false; }
})();
const state = (() => {
  const base = { quests: [], place: null, mode: 'rain', volume: 0.6 };
  if (!canStore) return base;
  try { return Object.assign(base, JSON.parse(localStorage.getItem(KEY)) || {}); }
  catch (e) { return base; }
})();
function save() {
  if (!canStore) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

/* ======================================================================
   WHERE YOU RISE — the Earth (Three.js on WebGL)
   A real Earth: 4K day and night imagery, relief, ocean glint and clouds,
   lit by the sun where it actually is right now, with a thin atmosphere.
   A slim leader names your place outside the planet; point at a country
   and it is named and drawn round in white (Natural Earth outlines).
   ====================================================================== */

const globeBox = document.getElementById('rise-globe');
const globeCanvas = document.getElementById('globe');
const globe = { ready: false, visible: false, placePin: null };

function latLon(lat, lon, r = 1) {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return [r * Math.cos(a) * Math.cos(b), r * Math.sin(a), -r * Math.cos(a) * Math.sin(b)];
}

/* where the sun is overhead right now, near enough for a picture */
function subsolar(d = new Date()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const day = (d.getTime() - start) / 864e5;
  const lat = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const lon = ((-15 * (hours - 12)) + 540) % 360 - 180;
  return { lat, lon };
}

async function buildGlobe() {
  let THREE, renderer;
  try {
    THREE = await import(THREE_URL);
    renderer = new THREE.WebGLRenderer({ canvas: globeCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    globeBox.classList.add('is-fallback');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  /* framed so the planet and its atmosphere always fit, however it turns */
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 5.1);
  const earth = new THREE.Group();
  scene.add(earth);

  const loader = new THREE.TextureLoader();
  const load = (url, srgb) => new Promise((res, rej) => loader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    res(t);
  }, undefined, rej));
  let day, night, brc;
  try {
    [day, night, brc] = await Promise.all([
      load('assets/earth/earth_day_4096.jpg', true),
      load('assets/earth/earth_night_4096.jpg', true),
      load('assets/earth/earth_bump_roughness_clouds_4096.jpg', false)
    ]);
  } catch (e) {
    globeBox.classList.add('is-fallback');
    return;
  }

  const sunU = { value: new THREE.Vector3(1, 0, 0) };
  function placeSun() {
    const s = subsolar();
    sunU.value.set(...latLon(s.lat, s.lon)).normalize();
  }
  placeSun();
  setInterval(placeSun, 60000);

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 128),
    new THREE.ShaderMaterial({
      uniforms: { uDay: { value: day }, uNight: { value: night }, uBRC: { value: brc }, uSun: sunU },
      vertexShader: `
        uniform vec3 uSun;
        varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec3 vSunV;
        void main(){
          vUv = uv;
          vObj = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vSunV = normalize(normalMatrix * uSun);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uBRC; uniform vec3 uSun;
        uniform sampler2D uSel; uniform float uSelOn;
        varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vObj; varying vec3 vSunV;
        void main(){
          vec3 n = normalize(vN), v = normalize(vView), l = normalize(vSunV);
          vec3 day = texture2D(uDay, vUv).rgb;
          vec3 night = texture2D(uNight, vUv).rgb;
          vec3 brc = texture2D(uBRC, vUv).rgb;
          float clouds = smoothstep(0.2, 1.0, brc.b);
          float rough = brc.g;

          float sunOrient = dot(vObj, uSun);
          float lit = smoothstep(-0.08, 0.14, sunOrient);
          float diffuse = clamp(dot(n, l), 0.0, 1.0) * 0.92 + 0.08;

          vec3 dayCol = mix(day, vec3(1.0), clouds * 0.92) * diffuse;
          vec3 nightCol = night * 1.4 * (1.0 - clouds * 0.75) * (1.0 - smoothstep(-0.12, 0.05, sunOrient) * 0.9);
          vec3 col = mix(nightCol, dayCol, lit);

          /* the sun glinting off open water */
          vec3 h = normalize(l + v);
          float spec = pow(max(dot(n, h), 0.0), 60.0) * (1.0 - rough) * (1.0 - clouds) * lit;
          col += vec3(1.0, 0.93, 0.8) * spec * 0.55;

          /* atmosphere on the limb: blue by day, warm where the day begins */
          float fres = 1.0 - max(dot(v, n), 0.0);
          vec3 atmo = mix(vec3(0.85, 0.45, 0.2), vec3(0.36, 0.62, 1.0), smoothstep(-0.02, 0.12, sunOrient));
          col = mix(col, atmo, pow(fres, 4.0) * smoothstep(-0.05, 0.6, sunOrient) * 0.7);

          /* the country under the pointer: lifted a little, drawn round in white */
          vec3 sel = texture2D(uSel, vUv).rgb * uSelOn;
          col = mix(col, col * 1.25 + vec3(0.035, 0.045, 0.05), sel.r * 0.7);
          col += vec3(0.85, 0.92, 1.0) * sel.b * 0.18;
          col = mix(col, vec3(1.0), clamp(sel.g * 1.15, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  earth.add(surface);

  /* the atmosphere seen past the edge of the planet */
  const air = new THREE.Mesh(
    new THREE.SphereGeometry(1.06, 96, 96),
    new THREE.ShaderMaterial({
      uniforms: { uSun: sunU },
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vN; varying vec3 vView; varying vec3 vObj;
        void main(){
          vObj = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uSun;
        varying vec3 vN; varying vec3 vView; varying vec3 vObj;
        void main(){
          float fres = 1.0 - abs(dot(normalize(vView), normalize(vN)));
          float a = pow(clamp(1.0 - (fres - 0.73) / 0.27, 0.0, 1.0), 3.0);
          float s = dot(vObj, uSun);
          vec3 c = mix(vec3(0.85, 0.45, 0.2), vec3(0.36, 0.62, 1.0), smoothstep(-0.02, 0.12, s));
          vec3 glow = c * a * smoothstep(-0.12, 0.7, s) * 1.6;
          /* additive light on a transparent canvas: alpha must match the light */
          gl_FragColor = vec4(glow, clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0));
          #include <colorspace_fragment>
        }`
    })
  );
  earth.add(air);

  /* you: a small bright point with a ring breathing out of it */
  const pin = new THREE.Group();
  const pinDot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.024, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  pin.add(pinDot, pinRing);
  earth.add(pin);

  /* ---- turning ----
     The Earth turns on its own axis (yaw) and tips towards you (pitch), so
     north stays up. It follows the pointer closely and, let go, it stops
     where it is: no sliding. Leave it alone and it glides back to the pin. */
  const cur = { yaw: 0, pitch: 0 }, tgt = { yaw: 0, pitch: 0 }, home = { yaw: 0, pitch: 0 };
  const PITCH = 1.3;
  let dragging = false, moved = 0, lastX = 0, lastY = 0, ease = 5, lastTouch = 0, inside = false;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function aim(yaw, pitch) {
    tgt.yaw = cur.yaw + wrap(yaw - cur.yaw);         /* the short way round */
    tgt.pitch = Math.max(-PITCH, Math.min(PITCH, pitch));
  }
  function facing(lat, lon) {
    /* the pin sits a touch left of and below centre; its label goes up and out
       into the space between the words and the planet */
    return { yaw: -Math.PI / 2 - lon * Math.PI / 180 - 0.2, pitch: lat * Math.PI / 180 * 0.92 + 0.1 };
  }

  /* ---- the label: a slim leader from the pin out past the planet's edge ---- */
  const stage = globeCanvas.parentElement;
  const leadIn = stage.querySelector('.lead-in');
  const leadOut = stage.querySelector('.lead-out');
  const leadEnd = stage.querySelector('.lead-end');
  const tag = document.getElementById('globe-tag');
  const tagName = tag.querySelector('.gt-name');
  const tagMeta = tag.querySelector('.gt-meta');
  const tagCoord = tag.querySelector('.gt-coord');
  let tagDraw = 0;                                    /* 0 → 1 as the leader draws on */
  function fmtCoord(v, pos, neg) { return Math.abs(v).toFixed(2) + '° ' + (v >= 0 ? pos : neg); }

  globe.placePin = (lat, lon, name) => {
    const p = latLon(lat, lon, 1.002);
    pin.position.set(...p);
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...p).normalize());
    const f = facing(lat, lon);
    home.yaw = f.yaw; home.pitch = f.pitch;
    if (!dragging) { aim(f.yaw, f.pitch); ease = reduced ? 30 : 3.2; }
    const parts = (name || '').split(',').map((s) => s.trim()).filter(Boolean);
    tagName.textContent = parts[0] || 'Your place';
    tagMeta.textContent = parts.slice(1).join(', ');
    tagCoord.textContent = fmtCoord(lat, 'N', 'S') + '  ' + fmtCoord(lon, 'E', 'W');
    tagDraw = reduced ? 1 : 0;
  };

  /* ---- countries: point at one to name it and outline it ---- */
  const hoverChip = document.getElementById('globe-hover');
  let countries = null, hovered = null, selOn = 0;
  const selCanvas = document.createElement('canvas');
  selCanvas.width = 2048; selCanvas.height = 1024;
  const selCtx = selCanvas.getContext('2d');
  const selTex = new THREE.CanvasTexture(selCanvas);
  const selU = { value: 0 };
  surface.material.uniforms.uSel = { value: selTex };
  surface.material.uniforms.uSelOn = selU;

  fetch('assets/earth/countries.json').then((r) => r.json()).then((list) => {
    countries = list.map(([name, b, rings]) => ({
      name,
      box: b.map((v) => v / 100),
      rings: rings.map((r) => Float32Array.from(r, (v) => v / 100))
    }));
  }).catch(() => {});

  function inRing(r, x, y) {
    let c = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function countryAt(lat, lon) {
    if (!countries) return null;
    for (const c of countries) {
      for (const x of [lon, lon + 360, lon - 360]) {
        if (x < c.box[0] || x > c.box[2] || lat < c.box[1] || lat > c.box[3]) continue;
        let n = 0;
        for (const r of c.rings) if (inRing(r, x, lat)) n++;
        if (n % 2) return c;
      }
    }
    return null;
  }

  /* the chosen country is drawn into a mask the surface shader reads:
     red is the fill, green the outline, blue a soft glow round it */
  function drawSelection(c) {
    const W = selCanvas.width, H = selCanvas.height;
    selCtx.globalCompositeOperation = 'source-over';
    selCtx.clearRect(0, 0, W, H);
    selCtx.fillStyle = '#000';
    selCtx.fillRect(0, 0, W, H);
    if (c) {
      selCtx.globalCompositeOperation = 'lighter';
      selCtx.lineJoin = 'round';
      const trace = (dx) => {
        selCtx.beginPath();
        for (const r of c.rings) {
          for (let i = 0; i < r.length; i += 2) {
            const x = (r[i] + dx + 180) / 360 * W, y = (90 - r[i + 1]) / 180 * H;
            if (i) selCtx.lineTo(x, y); else selCtx.moveTo(x, y);
          }
          selCtx.closePath();
        }
      };
      for (const dx of [-360, 0, 360]) {
        trace(dx);
        selCtx.fillStyle = '#f00';
        selCtx.fill('evenodd');
        selCtx.shadowColor = '#00f'; selCtx.shadowBlur = 10;
        selCtx.strokeStyle = '#00f'; selCtx.lineWidth = 4;
        selCtx.stroke();
        selCtx.shadowBlur = 0;
        selCtx.strokeStyle = '#0f0'; selCtx.lineWidth = 2.2;
        selCtx.stroke();
      }
    }
    selTex.needsUpdate = true;
  }
  drawSelection(null);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const ball = new THREE.Sphere(new THREE.Vector3(), 1), inv = new THREE.Quaternion();
  let pointer = null;                                 /* last pointer position on the stage */
  function pick() {
    if (!pointer) return null;
    const rect = globeCanvas.getBoundingClientRect();
    ndc.set((pointer.x / rect.width) * 2 - 1, -(pointer.y / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectSphere(ball, hit)) return null;
    hit.applyQuaternion(inv.copy(earth.quaternion).invert());
    const lat = Math.asin(Math.max(-1, Math.min(1, hit.y))) * 180 / Math.PI;
    const lon = Math.atan2(-hit.z, hit.x) * 180 / Math.PI;
    return { lat, lon, country: countryAt(lat, lon) };
  }
  function setHover(c) {
    if (c === hovered) return;
    hovered = c;
    if (c) { drawSelection(c); selOn = 0; hoverChip.textContent = c.name; }
    hoverChip.classList.toggle('is-on', !!c);
    stage.classList.toggle('is-pointing', !!c);
  }
  function placeChip() {
    if (!pointer || !hovered) return;
    const w = hoverChip.offsetWidth, W = stage.clientWidth;
    let x = pointer.x + 16, y = pointer.y + 18;
    if (x + w > W - 4) x = pointer.x - 16 - w;
    hoverChip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  /* ---- pointer ---- */
  const local = (e) => {
    const rect = globeCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  globeCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = 0; ease = 16;
    lastX = e.clientX; lastY = e.clientY;
    tgt.yaw = cur.yaw; tgt.pitch = cur.pitch;
    globeCanvas.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  });
  globeCanvas.addEventListener('pointermove', (e) => {
    pointer = local(e);
    inside = true;
    lastTouch = performance.now();
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      const k = 3.2 / globeCanvas.clientHeight;       /* about a turn across the planet */
      tgt.yaw += dx * k;
      tgt.pitch = Math.max(-PITCH, Math.min(PITCH, tgt.pitch + dy * k));
      if (moved > 4) setHover(null);
      return;
    }
    if (e.pointerType === 'mouse') { const p = pick(); setHover(p && p.country); placeChip(); }
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    lastTouch = performance.now();
    /* stop here: aim where the pointer left it, with nothing carried over */
    tgt.yaw = cur.yaw + (tgt.yaw - cur.yaw) * 0.35;
    tgt.pitch = cur.pitch + (tgt.pitch - cur.pitch) * 0.35;
    ease = 22;
    if (e.type === 'pointerup' && moved < 5) {
      /* a click, not a drag: go to the country under the pointer */
      pointer = local(e);
      const p = pick();
      if (p && p.country) {
        riseStatus.textContent = 'Showing ' + p.country.name + '. Search again, or use your own location.';
        placeInput.value = '';
        loadPlace({ lat: p.lat, lon: p.lon, name: p.country.name }, true).then(() => award('rise', 50));
      }
    }
  };
  globeCanvas.addEventListener('pointerup', endDrag);
  globeCanvas.addEventListener('pointercancel', endDrag);
  globeCanvas.addEventListener('pointerleave', () => {
    inside = false; pointer = null; lastTouch = performance.now();
    if (!dragging) setHover(null);
  });

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    /* the planet fills 84% of the height, its atmosphere a little more */
    const alpha = Math.asin(1 / camera.position.z);
    camera.fov = 2 * Math.atan(Math.tan(alpha) / 0.84) * 180 / Math.PI;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---- each frame ---- */
  const pinW = new THREE.Vector3(), pinN = new THREE.Vector3(), toCam = new THREE.Vector3(), scr = new THREE.Vector3();
  const smooth = (a, b) => (x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const fadeFacing = smooth(0.1, 0.32);
  function placeTag(dt) {
    const W = stage.clientWidth, H = stage.clientHeight;
    pin.getWorldPosition(pinW);
    pinN.copy(pinW).normalize();
    toCam.copy(camera.position).sub(pinW).normalize();
    const vis = fadeFacing(pinN.dot(toCam));
    scr.copy(pinW).project(camera);
    const px = (scr.x + 1) / 2 * W, py = (1 - scr.y) / 2 * H;
    const cx = W / 2, cy = H / 2, rs = H * 0.42;

    /* out at 45°, towards the side the pin is on, unless the words would
       not fit there */
    const sy = py <= cy + rs * 0.3 ? -1 : 1;
    const ox = px - cx, oy = py - cy;
    const lead = (sx) => {
      const dx = sx * Math.SQRT1_2, dy = sy * Math.SQRT1_2;
      const b = ox * dx + oy * dy, c0 = ox * ox + oy * oy;
      const reach = (R) => -b + Math.sqrt(Math.max(0, b * b - (c0 - R * R)));
      const tS = reach(rs), tE = reach(rs + 24);
      const E = [px + dx * tE, Math.max(14, Math.min(H - 14, py + dy * tE))];
      return { sx, S: [px + dx * tS, py + dy * tS], E, T: [E[0] + sx * 24, E[1]] };
    };
    const tw = tag.offsetWidth;
    const fits = (g) => g.sx > 0 ? g.T[0] + 10 + tw <= W + 40 : g.T[0] - 10 - tw >= -60;
    let g = lead(px > cx + rs * 0.15 ? 1 : -1);
    if (!fits(g)) { const o = lead(-g.sx); if (fits(o)) g = o; }
    const { sx, S, E, T } = g;

    if (tagDraw < 1) tagDraw = Math.min(1, tagDraw + dt / 1.1);
    const k = tagDraw;
    const inK = smooth(0.0, 0.35)(k), outK = smooth(0.3, 0.75)(k), txtK = smooth(0.6, 1)(k);
    leadIn.setAttribute('d', 'M' + px.toFixed(1) + ' ' + py.toFixed(1) + 'L' + S[0].toFixed(1) + ' ' + S[1].toFixed(1));
    leadOut.setAttribute('d', 'M' + S[0].toFixed(1) + ' ' + S[1].toFixed(1) + 'L' + E[0].toFixed(1) + ' ' + E[1].toFixed(1) +
      'L' + T[0].toFixed(1) + ' ' + T[1].toFixed(1));
    leadIn.style.strokeDashoffset = 1 - inK;
    leadOut.style.strokeDashoffset = 1 - outK;
    leadEnd.setAttribute('cx', T[0].toFixed(1));
    leadEnd.setAttribute('cy', T[1].toFixed(1));
    leadEnd.style.opacity = outK >= 1 ? 1 : 0;
    stage.style.setProperty('--tag-vis', vis.toFixed(3));
    tag.classList.toggle('is-left', sx < 0);
    tag.style.opacity = (vis * txtK).toFixed(3);
    tag.style.transform = 'translate(' + (T[0] + sx * 10).toFixed(1) + 'px,' + T[1].toFixed(1) + 'px) translate(' +
      (sx < 0 ? '-100%' : '0') + ',-50%) translateX(' + ((1 - txtK) * sx * -8).toFixed(1) + 'px)';
  }

  let t0 = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
    if (globe.visible && !document.hidden) {
      /* left alone for a while, the Earth glides back to your place */
      if (!dragging && !inside && now - lastTouch > 4000 &&
          (Math.abs(wrap(home.yaw - tgt.yaw)) > 1e-3 || Math.abs(home.pitch - tgt.pitch) > 1e-3)) {
        aim(home.yaw, home.pitch); ease = 2.6;
      }
      const f = 1 - Math.exp(-dt * ease);
      const before = cur.yaw + cur.pitch;
      cur.yaw += (tgt.yaw - cur.yaw) * f;
      cur.pitch += (tgt.pitch - cur.pitch) * f;
      earth.rotation.set(cur.pitch, cur.yaw, 0, 'XYZ');
      earth.updateMatrixWorld();

      /* keep the outline true while the planet moves under a still pointer */
      if (inside && !dragging && Math.abs(cur.yaw + cur.pitch - before) > 1e-5) {
        const p = pick(); setHover(p && p.country);
      }
      selOn += ((hovered ? 1 : 0) - selOn) * (1 - Math.exp(-dt * 14));
      selU.value = selOn;

      const k = (now / 1000) % 2.4 / 2.4;
      pinRing.scale.setScalar(1 + k * 3);
      pinRing.material.opacity = (1 - k) * 0.9;
      placeTag(dt);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }

  globe.ready = true;
  const p = state.place || HOME;
  const f0 = facing(p.lat, p.lon);
  cur.yaw = tgt.yaw = f0.yaw - 0.9; cur.pitch = tgt.pitch = f0.pitch;   /* arrive with a short turn */
  globe.placePin(p.lat, p.lon, p.name);
  requestAnimationFrame(frame);
  globeBox.classList.add('is-ready');
}

/* load Three.js and the imagery only as the section comes near, and draw
   only while the globe is on screen */
const near = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) {
    near.disconnect();
    buildGlobe();
    loadPlace(state.place || HOME, !!state.place);
  }
}, { rootMargin: '900px 0px' });
near.observe(globeBox);
new IntersectionObserver((entries) => { globe.visible = entries[0].isIntersecting; }).observe(globeBox);

/* ======================================================================
   WHERE YOU RISE — Geolocation API + Fetch API
   ====================================================================== */

const riseLine = document.getElementById('rise-line');
const riseStatus = document.getElementById('rise-status');
const locateBtn = document.getElementById('rise-locate');
let sunriseAt = 0, sunriseLabel = '', sunriseDay = '';

const WEATHER = [[0, 'clear'], [1, 'mostly clear'], [2, 'partly cloudy'], [3, 'overcast'], [45, 'fog'], [48, 'fog'],
  [51, 'drizzle'], [56, 'freezing drizzle'], [61, 'rain'], [66, 'freezing rain'], [71, 'snow'], [77, 'snow grains'],
  [80, 'showers'], [85, 'snow showers'], [95, 'thunderstorms']];
function weatherWord(code) {
  let w = 'clear';
  for (const [c, word] of WEATHER) if (code >= c) w = word;
  return w;
}

/* "2026-09-23T06:08" in a place with a known UTC offset → a real moment */
function localToEpoch(s, offsetSec) {
  const [d, t] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, hh, mm) - offsetSec * 1000;
}
function clockLabel(s) {
  let [hh, mm] = s.split('T')[1].split(':').map(Number);
  const ap = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return hh + ':' + String(mm).padStart(2, '0') + ' ' + ap;
}

async function loadPlace(place, isYours) {
  const { lat, lon } = place;
  const weather = fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) +
    '&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=2')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const named = isYours && !place.name
    ? fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=en')
      .then((r) => r.json())
      .then((g) => {
        let country = g.countryName;
        try { if (g.countryCode) country = new Intl.DisplayNames(['en'], { type: 'region' }).of(g.countryCode); } catch (e) {}
        return [g.city || g.locality || g.principalSubdivision, country].filter(Boolean).join(', ');
      })
      .catch(() => '')
    : Promise.resolve(place.name);

  try {
    const [w, name] = await Promise.all([weather, named]);
    const here = name || 'Your location';
    if (isYours) { state.place = { lat, lon, name: here }; save(); }

    const now = Date.now();
    const off = w.utc_offset_seconds || 0;
    const rises = w.daily.sunrise.map((s) => [localToEpoch(s, off), s]);
    const next = rises.find(([at]) => at > now) || rises[rises.length - 1];
    sunriseAt = next[0];
    sunriseLabel = clockLabel(next[1]);
    sunriseDay = next[1].slice(0, 10) === w.daily.sunrise[0].slice(0, 10) ? 'today' : 'tomorrow';

    document.getElementById('rise-place').textContent = here;
    document.getElementById('rise-sun').textContent = sunriseLabel;
    document.getElementById('rise-now').textContent =
      Math.round(w.current.temperature_2m) + '°, ' + weatherWord(w.current.weather_code);
    riseLine.textContent = 'The sun comes up over ' + here.split(',')[0] + ' at ' + sunriseLabel + ' ' + sunriseDay +
      '. That first hour is yours. Spend it on the one thing that matters.';
    if (!isYours) riseStatus.textContent = 'Showing Bengaluru. Search any city or country, or use your own location.';
    tickSunrise();
    if (globe.ready && globe.placePin) globe.placePin(lat, lon, here);
  } catch (e) {
    riseStatus.textContent = 'The weather service did not answer. Try again in a moment.';
  }
}

function tickSunrise() {
  if (!sunriseAt) return;
  const ms = Math.max(0, sunriseAt - Date.now());
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
  document.getElementById('rise-in').textContent = h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
}
setInterval(tickSunrise, 1000);

locateBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    riseStatus.textContent = 'This browser cannot share a location.';
    return;
  }
  locateBtn.disabled = true;
  locateBtn.textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition((pos) => {
    locateBtn.disabled = false;
    locateBtn.textContent = 'Use my location';
    riseStatus.textContent = 'Located to within ' + Math.round(pos.coords.accuracy) + ' m. Coordinates go only to Open-Meteo and BigDataCloud.';
    loadPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude }, true).then(() => award('rise', 50));
  }, (err) => {
    locateBtn.disabled = false;
    locateBtn.textContent = 'Use my location';
    riseStatus.textContent = err.code === 1
      ? 'Location is blocked for this site. Allow it in the browser to see your sunrise.'
      : 'Your location could not be found just now. Try again.';
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
});
/* the button always offers your own location; search is the other way in */

/* ---- or choose a place: Open-Meteo geocoding, any city or country ---- */
const placeInput = document.getElementById('place-input');
const placeList = document.getElementById('place-list');
let placeResults = [], placeActive = -1, placeTimer = 0, placeAbort = null;

function placeLabel(r) {
  /* a country is just its name; a city gets its region and country */
  if (/^PCL/.test(r.feature_code || '')) return { name: r.name, where: 'Country', full: r.name };
  const where = [r.admin1, r.country].filter((x, i, a) => x && a.indexOf(x) === i && x !== r.name).join(', ');
  return { name: r.name, where, full: [r.name, r.country].filter(Boolean).join(', ') };
}

function closePlaces() {
  placeList.hidden = true;
  placeInput.setAttribute('aria-expanded', 'false');
  placeInput.removeAttribute('aria-activedescendant');
  placeActive = -1;
}

function markActive(i) {
  placeActive = i;
  [...placeList.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
  if (i >= 0 && placeList.children[i]) {
    placeInput.setAttribute('aria-activedescendant', placeList.children[i].id);
    placeList.children[i].scrollIntoView({ block: 'nearest' });
  }
}

function showPlaces(results) {
  placeResults = results;
  placeList.textContent = '';
  if (!results.length) {
    const li = document.createElement('li');
    li.className = 'pl-empty';
    li.textContent = 'No places found';
    li.setAttribute('aria-disabled', 'true');
    placeList.appendChild(li);
  }
  results.forEach((r, i) => {
    const l = placeLabel(r);
    const li = document.createElement('li');
    li.id = 'place-opt-' + i;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    const n = document.createElement('span'); n.className = 'pl-name'; n.textContent = l.name;
    const w = document.createElement('span'); w.className = 'pl-where'; w.textContent = l.where;
    li.append(n, w);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); choosePlace(i); });
    li.addEventListener('mousemove', () => { if (placeActive !== i) markActive(i); });
    placeList.appendChild(li);
  });
  placeList.hidden = false;
  placeInput.setAttribute('aria-expanded', 'true');
  markActive(results.length ? 0 : -1);
}

function searchPlaces(q) {
  if (placeAbort) placeAbort.abort();
  placeAbort = new AbortController();
  fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=en&format=json',
    { signal: placeAbort.signal })
    .then((r) => r.json())
    .then((d) => { if (placeInput.value.trim() === q) showPlaces(d.results || []); })
    .catch((e) => { if (e.name !== 'AbortError') riseStatus.textContent = 'Place search is unavailable right now.'; });
}

function choosePlace(i) {
  const r = placeResults[i];
  if (!r) return;
  const l = placeLabel(r);
  placeInput.value = l.full;
  closePlaces();
  placeInput.blur();
  riseStatus.textContent = 'Showing ' + l.full + '. Search again, or use your own location.';
  loadPlace({ lat: r.latitude, lon: r.longitude, name: l.full }, true).then(() => award('rise', 50));
}

placeInput.addEventListener('input', () => {
  clearTimeout(placeTimer);
  const q = placeInput.value.trim();
  if (q.length < 2) { closePlaces(); return; }
  placeTimer = setTimeout(() => searchPlaces(q), 220);
});
placeInput.addEventListener('keydown', (e) => {
  const open = !placeList.hidden && placeResults.length;
  if (e.key === 'ArrowDown' && open) { e.preventDefault(); markActive((placeActive + 1) % placeResults.length); }
  else if (e.key === 'ArrowUp' && open) { e.preventDefault(); markActive((placeActive - 1 + placeResults.length) % placeResults.length); }
  else if (e.key === 'Enter') { e.preventDefault(); if (open) choosePlace(Math.max(0, placeActive)); }
  else if (e.key === 'Escape') closePlaces();
});
placeInput.addEventListener('blur', () => setTimeout(closePlaces, 120));
placeInput.addEventListener('focus', () => { if (placeResults.length && placeInput.value.trim().length >= 2) showPlaces(placeResults); });

/* ======================================================================
   SPEAK A QUEST — speech to text, text to speech, Local Storage

   Hearing you. Where the browser's own recogniser works (Chrome, Edge)
   the Web Speech API transcribes live. Where it doesn't (Brave ships the
   API but blocks the service behind it, Firefox has none), the page
   records with getUserMedia + MediaRecorder and transcribes on-device with
   Whisper (Transformers.js), so nothing leaves the machine.

   Answering you. The coach speaks in Microsoft's en-GB-RyanNeural, the
   voice of Solo Leveling OS. Its lines are rendered from Microsoft Edge's
   neural text-to-speech into assets/voice/. When the browser itself offers
   Ryan (Microsoft Edge does), it also reads your quest back in his voice.
   ====================================================================== */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const WHISPER_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const WHISPER_MODEL = 'onnx-community/whisper-tiny.en';
const mic = document.getElementById('vq-mic');
const meter = [...root.querySelectorAll('.vq-meter i')];
const live = document.getElementById('vq-live');
const vqList = document.getElementById('vq-list');
const vqStatus = document.getElementById('vq-status');
const defaultStatus = vqStatus.textContent;

/* ---- the coach's voice ---- */
const LINES = { accepted: ['accepted-1', 'accepted-2', 'accepted-3'], done: ['done'], retry: ['retry'] };
const clips = {};
function clip(name) {
  if (!clips[name]) { clips[name] = new Audio('assets/voice/' + name + '.mp3'); clips[name].preload = 'auto'; }
  return clips[name];
}
let ryan = null;
function findRyan() {
  if (!('speechSynthesis' in window)) return;
  ryan = speechSynthesis.getVoices().find((v) => /ryan/i.test(v.name) && /en-GB/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  findRyan();
  speechSynthesis.addEventListener('voiceschanged', findRyan);
}
function coach(kind, readBack) {
  const names = LINES[kind];
  const a = clip(names[Math.floor(Math.random() * names.length)]);
  try { a.currentTime = 0; } catch (e) {}
  const then = () => {
    if (!readBack || !ryan) return;
    const u = new SpeechSynthesisUtterance(readBack);
    u.voice = ryan; u.lang = ryan.lang; u.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  a.onended = then;
  a.play().catch(then);
}

/* ---- quests ---- */
function tidy(text) {
  const t = text.replace(/\s+/g, ' ').replace(/^[\s,.]+/, '').trim().replace(/[.!?]+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1, 60);
}

function addQuest(text) {
  const t = tidy(text);
  if (!t) { coach('retry'); return; }
  state.quests.unshift({ id: 'v' + Date.now().toString(36), text: t, done: false });
  state.quests = state.quests.slice(0, 8);
  save();
  renderQuests();
  live.textContent = '“' + t + '”';
  coach('accepted', t);
}

function renderQuests() {
  vqList.textContent = '';
  if (!state.quests.length) {
    const li = document.createElement('li');
    li.className = 'vq-empty';
    li.textContent = 'Your quests will appear here.';
    vqList.appendChild(li);
  }
  state.quests.forEach((q) => {
    const li = document.createElement('li');
    li.className = 'vq-item' + (q.done ? ' is-done' : '');
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'vq-check';
    check.setAttribute('aria-pressed', q.done ? 'true' : 'false');
    check.setAttribute('aria-label', (q.done ? 'Mark not done: ' : 'Mark done: ') + q.text);
    check.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
    check.addEventListener('click', () => {
      q.done = !q.done;
      if (q.done) { award('vq-' + q.id, 25); coach('done'); }
      save(); renderQuests();
    });
    const text = document.createElement('span');
    text.className = 'vq-text';
    text.textContent = q.text;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'vq-del';
    del.setAttribute('aria-label', 'Remove: ' + q.text);
    del.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
    del.addEventListener('click', () => {
      state.quests = state.quests.filter((x) => x !== q);
      save(); renderQuests();
    });
    li.append(check, text, del);
    vqList.appendChild(li);
  });
}

/* ---- listening UI ---- */
let busy = false;
function setListening(on, driven) {
  mic.classList.toggle('is-listening', on);
  mic.classList.toggle('is-driven', !!driven);
  mic.setAttribute('aria-pressed', on ? 'true' : 'false');
  mic.setAttribute('aria-label', on ? 'Stop listening' : 'Speak a quest');
  if (!on) meter.forEach((b) => { b.style.height = ''; });
}
function say(msg) { vqStatus.textContent = msg || defaultStatus; }

/* ---- engine 1: the browser's own recogniser ---- */
let engine = 'whisper';
const isBrave = !!(navigator.brave && navigator.brave.isBrave);
if (SR && !isBrave) engine = 'native';

let rec = null, heard = '', nativeOn = false;
function startNative() {
  rec = new SR();
  rec.lang = 'en-GB';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  heard = '';
  rec.onstart = () => { nativeOn = true; setListening(true, false); live.textContent = 'Listening…'; say(); };
  rec.onresult = (e) => {
    let text = '';
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    heard = text;
    live.textContent = '“' + text + '”';
  };
  rec.onerror = (e) => {
    if (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
      /* the recogniser exists but its service does not: switch to on-device */
      engine = 'whisper';
      say('Switched to on-device transcription. Tap the mic again.');
    } else if (e.error === 'not-allowed') {
      say('The microphone is blocked for this site. Allow it in the address bar, or type the quest.');
    } else if (e.error === 'no-speech') {
      coach('retry');
    }
  };
  rec.onend = () => {
    nativeOn = false;
    setListening(false);
    if (heard.trim()) addQuest(heard);
    else if (live.textContent === 'Listening…') live.textContent = '“Read for twenty minutes”';
  };
  try { rec.start(); } catch (e) { say('Speech could not start. Try again.'); }
}

/* ---- engine 2: record, then Whisper on this device ---- */
let asr = null, asrLoading = null;
function loadWhisper() {
  if (asrLoading) return asrLoading;
  asrLoading = (async () => {
    const { pipeline } = await import(WHISPER_URL);
    const files = {};
    asr = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file] = [p.loaded, p.total];
        let got = 0, all = 0;
        Object.values(files).forEach(([a, b]) => { got += a; all += b; });
        if (busy) say('Loading the on-device voice model, first time only — ' + Math.round(got / all * 100) + '%');
      }
    });
    return asr;
  })();
  asrLoading.catch(() => { asrLoading = null; });
  return asrLoading;
}

let recorder = null, stream = null, meterCtx = null, stopTimer = 0;
async function startWhisper() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch (e) {
    say(e.name === 'NotAllowedError'
      ? 'The microphone is blocked for this site. Allow it in the address bar, or type the quest.'
      : 'No microphone was found. You can type the quest instead.');
    return;
  }
  loadWhisper();                                   /* fetch the model while you speak */
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => transcribe(new Blob(chunks, { type: recorder.mimeType }));
  recorder.start();
  setListening(true, true);
  live.textContent = 'Listening…';
  say('Speak, then pause. It stops on its own.');

  /* a real level meter, and stop after a pause once you have spoken */
  const AC = window.AudioContext || window.webkitAudioContext;
  meterCtx = new AC();
  const src = meterCtx.createMediaStreamSource(stream);
  const an = meterCtx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let spoke = false, quietSince = 0;
  const started = performance.now();
  (function watch() {
    if (!recorder || recorder.state !== 'recording') return;
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    meter.forEach((b, i) => {
      const k = Math.min(1, rms * (14 + i * 3) * (0.7 + 0.3 * Math.sin(performance.now() / 90 + i)));
      b.style.height = Math.round(20 + k * 80) + '%';
    });
    const now = performance.now();
    if (rms > 0.03) { spoke = true; quietSince = 0; }
    else if (spoke) {
      if (!quietSince) quietSince = now;
      if (now - quietSince > 1200) { stopWhisper(); return; }
    }
    if (now - started > 9000) { stopWhisper(); return; }
    requestAnimationFrame(watch);
  })();
}

function stopWhisper() {
  if (recorder && recorder.state === 'recording') recorder.stop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (meterCtx) meterCtx.close().catch(() => {});
  stream = null; meterCtx = null;
  setListening(false);
}

async function transcribe(blob) {
  busy = true;
  mic.disabled = true;
  live.textContent = 'Writing it down…';
  try {
    const model = await loadWhisper();
    say();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close().catch(() => {});
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const s = off.createBufferSource(); s.buffer = decoded; s.connect(off.destination); s.start();
    const audio = (await off.startRendering()).getChannelData(0);
    const out = await model(audio);
    const text = (out && out.text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
    if (text.length > 1) addQuest(text);
    else { live.textContent = '“Read for twenty minutes”'; coach('retry'); }
  } catch (e) {
    say('The voice model could not load. Check the connection, or type the quest.');
    live.textContent = '“Read for twenty minutes”';
  } finally {
    busy = false;
    mic.disabled = false;
  }
}

mic.addEventListener('click', () => {
  if (busy) return;
  if (WR.startSound) WR.startSound();
  if (engine === 'native') {
    if (nativeOn) rec.stop(); else startNative();
    return;
  }
  if (recorder && recorder.state === 'recording') stopWhisper();
  else if (navigator.mediaDevices && window.MediaRecorder) startWhisper();
  else say('This browser cannot record audio. Type the quest instead.');
});

document.getElementById('vq-type').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('vq-input');
  if (!input.value.trim()) { input.focus(); return; }
  addQuest(input.value);
  input.value = '';
});
if (!canStore) say('Storage is off in this browser, so quests reset when you leave.');

/* ======================================================================
   FOCUS SOUNDSCAPE — Web Audio API + Canvas API
   ====================================================================== */

const viz = document.getElementById('fs-viz');
const vctx = viz.getContext('2d');
const playBtn = document.getElementById('fs-play');
const volume = document.getElementById('fs-vol');
const fs = { ctx: null, out: null, analyser: null, bins: null, layer: null, playing: false, t: 0, seen: false };
volume.value = state.volume;

function noiseBuffer(ctx, kind) {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
  }
  return buf;
}

function makeLayer(mode) {
  const ctx = fs.ctx;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(fs.out);
  const stops = [];

  if (mode === 'rain') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 'white'); src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const body = ctx.createGain(); body.gain.value = 0.22;
    src.connect(hp); hp.connect(lp); lp.connect(body); body.connect(gain);
    src.start();
    /* single drops, scattered */
    const drops = setInterval(() => {
      const t = ctx.currentTime + Math.random() * 0.1;
      const o = ctx.createBufferSource(); o.buffer = src.buffer;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200 + Math.random() * 4200; bp.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.35, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(bp); bp.connect(g); g.connect(gain);
      o.start(t, Math.random() * 3, 0.08);
    }, 45);
    stops.push(() => { clearInterval(drops); src.stop(); });
  } else if (mode === 'brown') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 'brown'); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0.9;
    src.connect(lp); lp.connect(g); g.connect(gain);
    src.start();
    stops.push(() => src.stop());
  } else {
    /* binaural alpha: 200 Hz left, 210 Hz right — a 10 Hz beat between the ears */
    [[200, -1], [210, 1]].forEach(([f, pan]) => {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      const g = ctx.createGain(); g.gain.value = 0.16;
      o.connect(g); g.connect(p); p.connect(gain); o.start();
      stops.push(() => o.stop());
    });
    const bed = ctx.createBufferSource(); bed.buffer = noiseBuffer(ctx, 'brown'); bed.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0.25;
    bed.connect(lp); lp.connect(g); g.connect(gain); bed.start();
    stops.push(() => bed.stop());
  }
  const t = ctx.currentTime;
  gain.gain.linearRampToValueAtTime(1, t + 0.8);
  return {
    stop() {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.7);
      setTimeout(() => { stops.forEach((s) => { try { s(); } catch (e) {} }); gain.disconnect(); }, 800);
    }
  };
}

function ensureAudio() {
  if (fs.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  fs.ctx = new AC();
  fs.out = fs.ctx.createGain();
  fs.out.gain.value = +volume.value;
  fs.analyser = fs.ctx.createAnalyser();
  fs.analyser.fftSize = 256;
  fs.analyser.smoothingTimeConstant = 0.82;
  fs.bins = new Uint8Array(fs.analyser.frequencyBinCount);
  fs.out.connect(fs.analyser);
  fs.analyser.connect(fs.ctx.destination);
}

function setPlaying(on) {
  if (on) {
    ensureAudio();
    if (fs.ctx.state === 'suspended') fs.ctx.resume();
    if (fs.layer) fs.layer.stop();
    fs.layer = makeLayer(state.mode);
    award('soundscape', 20);
  } else if (fs.layer) {
    fs.layer.stop();
    fs.layer = null;
  }
  fs.playing = on;
  playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  playBtn.setAttribute('aria-label', on ? 'Pause the soundscape' : 'Play the soundscape');
  if (WR.duckAmbient) WR.duckAmbient(on);
}

playBtn.addEventListener('click', () => setPlaying(!fs.playing));
const modes = [...root.querySelectorAll('.segmented [data-mode]')];
function pickMode(btn, focus) {
  state.mode = btn.dataset.mode; save();
  modes.forEach((m) => {
    const on = m === btn;
    m.setAttribute('aria-checked', on ? 'true' : 'false');
    m.tabIndex = on ? 0 : -1;
  });
  if (focus) btn.focus();
  if (fs.playing) setPlaying(true);
}
modes.forEach((m, i) => {
  const on = m.dataset.mode === state.mode;
  m.setAttribute('aria-checked', on ? 'true' : 'false');
  m.tabIndex = on ? 0 : -1;
  m.addEventListener('click', () => pickMode(m, false));
  m.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    pickMode(modes[(i + step + modes.length) % modes.length], true);
  });
});
volume.addEventListener('input', () => {
  state.volume = +volume.value; save();
  if (fs.out) fs.out.gain.setTargetAtTime(+volume.value, fs.ctx.currentTime, 0.05);
});

/* the canvas: a row of level bars, like a voice memo */
function sizeViz() {
  const r = viz.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viz.width = Math.round(r.width * dpr);
  viz.height = Math.round(r.height * dpr);
}
new ResizeObserver(sizeViz).observe(viz);
new IntersectionObserver((e) => { fs.seen = e[0].isIntersecting; }).observe(viz);

const level = new Float32Array(64);
function drawViz() {
  requestAnimationFrame(drawViz);
  if (!fs.seen || document.hidden || !viz.width) return;
  const W = viz.width, H = viz.height, mid = H / 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const n = Math.max(24, Math.min(64, Math.floor(W / (9 * dpr))));
  const gap = W / n, bw = Math.max(2 * dpr, gap * 0.42);

  let data = null;
  if (fs.playing && fs.analyser) { fs.analyser.getByteFrequencyData(fs.bins); data = fs.bins; }
  for (let i = 0; i < n; i++) {
    /* fold the spectrum so the loudest bands sit in the middle */
    const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    /* each bar listens to its own band; the envelope keeps the middle tallest */
    const band = data ? data[Math.floor((0.04 + 0.5 * Math.pow(d, 1.4)) * data.length)] / 255 : 0;
    const shimmer = reduced ? 1 : 0.82 + 0.18 * Math.sin(performance.now() / 260 + i * 1.9);
    const want = band * (0.28 + 0.72 * (1 - d * d)) * shimmer;
    level[i] += (want - level[i]) * (want > level[i] ? 0.45 : 0.12);
  }

  vctx.clearRect(0, 0, W, H);
  vctx.fillStyle = fs.playing ? '#2c7a4b' : 'rgba(20, 50, 40, 0.18)';
  for (let i = 0; i < n; i++) {
    const h = Math.max(bw, level[i] * H * 0.92);
    const x = i * gap + (gap - bw) / 2;
    vctx.beginPath();
    if (vctx.roundRect) vctx.roundRect(x, mid - h / 2, bw, h, bw / 2);
    else vctx.rect(x, mid - h / 2, bw, h);
    vctx.fill();
  }
}
requestAnimationFrame(drawViz);

/* ======================================================================
   ARRIVAL
   ====================================================================== */

if (!reduced && window.gsap && window.ScrollTrigger) {
  gsap.from(root.querySelectorAll('.sys-head > *, .tile'), {
    y: 40, autoAlpha: 0, duration: 1.1, ease: 'power3.out', stagger: 0.08,
    scrollTrigger: { trigger: root, start: 'top 75%', once: true }
  });
}

renderQuests();
