// Liquid Glass для теми Aqua.
// Один WebGL-шар за сайтом малює фон (градієнт + фото з паралаксом) і всі скляні кнопки.
// Заломлення — власна фізика: кожна кнопка — скляна плитка з заокругленим краєм (профіль чверть-кола).
// Промінь з ока падає на поверхню, заломлюється за законом Снелла (n ≈ 1.45–1.52, окремо для R/G/B),
// проходить товщу скла і "влучає" у фон. Розмиття — через mip-рівні фону: біля краю слабке, до центру сильніше.
(() => {
  'use strict';
  const root = document.documentElement;
  const SEL = '.link-card, .theme-toggle, .username-badge, .nested-btn:not([class*="is-highlight"])';
  const MAX = 24;

  let gl = null, canvas = null, started = false, failed = false;
  let progBg, progGlass, fbo, fboTex, quad, photoTex = null, photo = null;
  let W = 0, H = 0, DPR = 1, BW = 0, BH = 0;
  let raf = null, lastBg = 0, lastSig = '';
  const t0 = performance.now();

  const isAqua = () => root.getAttribute('data-theme') === 'aqua';

  // ---------- Шейдери ----------
  const VS = `#version 300 es
  in vec2 a; out vec2 vUv;
  void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

  // Фон: градієнт Aqua, що повільно переливається, + фото 35% з паралаксом (як у CSS-версії)
  const FS_BG = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 o;
  uniform vec2 uView; uniform float uTime, uProg, uHasPhoto; uniform vec2 uPhotoSize;
  uniform sampler2D uPhoto;
  vec3 ramp(float t){
    vec3 c0 = vec3(0.086,0.259,0.357), c1 = vec3(0.129,0.388,0.514), c2 = vec3(0.247,0.561,0.592), c3 = vec3(0.443,0.749,0.737);
    if (t < 0.38) return mix(c0, c1, t / 0.38);
    if (t < 0.70) return mix(c1, c2, (t - 0.38) / 0.32);
    return mix(c2, c3, (t - 0.70) / 0.30);
  }
  void main(){
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uView;            // css px, (0,0) — лівий верх
    float ph = 0.5 + 0.5 * sin(uTime * 6.2831 / 28.0);
    float t = clamp((p.x / uView.x + p.y / uView.y) * 0.5 * 0.62 + ph * 0.38, 0.0, 1.0);
    vec3 col = ramp(t);
    if (uHasPhoto > 0.5) {
      float boxTop = -0.2 * uView.y + (0.5 - uProg) * uView.y * 0.3;
      float boxH = 1.4 * uView.y;
      float k = max(uView.x / uPhotoSize.x, boxH / uPhotoSize.y);
      vec2 sz = uPhotoSize * k;
      vec2 pos = vec2((uView.x - sz.x) * 0.62, boxTop + (boxH - sz.y) * 0.5);
      vec2 uv = (p - pos) / sz;
      col = mix(col, texture(uPhoto, uv).rgb, 0.35);
    }
    o = vec4(col, 1.0);
  }`;

  // Скло
  const FS_GLASS = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 o;
  uniform sampler2D uBg; uniform vec2 uView; uniform float uMaxLod;
  uniform int uN; uniform vec4 uRect[${MAX}]; uniform vec4 uClip[${MAX}]; uniform vec2 uRA[${MAX}];

  float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  vec2 uvOf(vec2 p){ return vec2(p.x / uView.x, 1.0 - p.y / uView.y); }
  vec2 bend(vec3 N, float ior, float depth){
    vec3 R = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / ior);   // закон Снелла
    return R.xy / max(-R.z, 0.25) * depth;
  }

  void main(){
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uView;
    vec3 col = textureLod(uBg, vUv, 0.0).rgb;
    for (int i = 0; i < ${MAX}; i++) {
      if (i >= uN) break;
      vec4 Rc = uRect[i];
      vec4 C = uClip[i];
      if (p.x < C.x || p.y < C.y || p.x > C.z || p.y > C.w) continue;
      vec2 b = Rc.zw * 0.5;
      vec2 q = p - (Rc.xy + b);
      float r = min(uRA[i].x, min(b.x, b.y));
      float d = sdRound(q, b, r);
      if (d > 0.5) continue;

      // Нормаль контуру (назовні) — з градієнта SDF
      vec2 e = vec2(0.75, 0.0);
      vec2 g = vec2(sdRound(q + e.xy, b, r) - sdRound(q - e.xy, b, r), sdRound(q + e.yx, b, r) - sdRound(q - e.yx, b, r));
      g = g / max(length(g), 1e-4);

      // Профіль товщини: плаский центр, край — чверть кола шириною bev
      float bev = min(min(b.x, b.y) * 0.9, 26.0);
      float din = max(-d, 0.0);
      float x = clamp(din / bev, 0.0, 1.0);
      float s1 = 1.0 - x;
      float hgt = sqrt(max(1.0 - s1 * s1, 0.0004));       // висота поверхні 0..1
      float slope = min(s1 / hgt, 6.0);                    // dh/dx
      vec3 N = normalize(vec3(g * slope, 1.0));            // нормаль поверхні (нахилена назовні на краю)
      float depth = hgt * bev * 0.9 + 6.0;                 // товща скла + зазор до фону

      // Розмиття: біля краю слабке, до центру сильніше
      float lod = mix(0.6, uMaxLod, smoothstep(0.0, bev * 1.6, din));
      // Основний колір — 4 зсунуті вибірки (м'яке розмиття без "квадратиків" mip-рівнів)
      vec2 pg = p + bend(N, 1.485, depth);
      float o1 = 1.3 * exp2(lod);
      vec3 base = (textureLod(uBg, uvOf(pg + vec2( o1,  o1 * 0.4)), lod).rgb +
                   textureLod(uBg, uvOf(pg + vec2(-o1 * 0.4,  o1)), lod).rgb +
                   textureLod(uBg, uvOf(pg + vec2(-o1, -o1 * 0.4)), lod).rgb +
                   textureLod(uBg, uvOf(pg + vec2( o1 * 0.4, -o1)), lod).rgb) * 0.25;
      // Дисперсія: червоний і синій заломлюються трохи інакше — райдужна кайма на краях
      float gC = textureLod(uBg, uvOf(pg), lod).g;
      vec3 gc = base;
      gc.r += textureLod(uBg, uvOf(p + bend(N, 1.45, depth)), lod).r - gC;
      gc.b += textureLod(uBg, uvOf(p + bend(N, 1.52, depth)), lod).b - gC;
      gc = max(gc, 0.0);

      // Колір скла: трохи світліше й насиченіше
      float lum = dot(gc, vec3(0.299, 0.587, 0.114));
      gc = mix(vec3(lum), gc, 1.35) * 1.05 + 0.025;

      // Відблиски: світло згори-зліва + Френель на краю
      vec3 L = normalize(vec3(-0.55, -0.75, 0.9));
      float spec = pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
      float fres = pow(1.0 - N.z, 2.2);
      float rimLine = smoothstep(1.6, 0.0, din) * 0.35;    // тонка світла грань по контуру
      float lit = 0.5 + 0.5 * dot(-g, normalize(vec2(0.6, 0.8)));   // верх-ліво яскравіше
      gc += vec3(1.0) * (spec * 0.55 + fres * 0.22 * (0.55 + 0.45 * lit) + rimLine * (0.4 + 0.6 * lit));

      float a = clamp(0.5 - d, 0.0, 1.0) * uRA[i].y;       // згладжений край і прозорість кнопки
      col = mix(col, gc, a);
    }
    o = vec4(col, 1.0);
  }`;

  function compile(vs, fs) {
    const mk = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  function init() {
    canvas = document.createElement('canvas');
    canvas.className = 'aqua-gl';
    canvas.setAttribute('aria-hidden', 'true');
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) throw new Error('no webgl2');
    document.body.insertBefore(canvas, document.body.firstChild);

    progBg = compile(VS, FS_BG);
    progGlass = compile(VS, FS_GLASS);

    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    fboTex = gl.createTexture();
    fbo = gl.createFramebuffer();

    // Фото (те саме, що й у CSS-версії)
    const url = (typeof PAGE_DATA !== 'undefined' && PAGE_DATA.aquaBackgroundImage) || null;
    if (url) {
      const img = new Image();
      img.onload = () => {
        photo = img;
        photoTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, photoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        lastBg = 0;
        kick();
      };
      img.src = url;
    }

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); root.classList.remove('lg-gl'); failed = true; });
    resize();
    window.addEventListener('resize', () => { resize(); kick(); });
  }

  function resize() {
    if (!gl) return;
    // Скло м'яке за природою — не треба рендерити в повній роздільності
    DPR = Math.min(window.devicePixelRatio || 1, 1.25);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    // Фон для заломлення — у половинній роздільності, з mip-рівнями для розмиття
    BW = Math.max(16, Math.round(canvas.width / 2));
    BH = Math.max(16, Math.round(canvas.height / 2));
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BW, BH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    lastBg = 0;
  }

  // ---------- Кнопки ----------
  const rects = new Float32Array(MAX * 4), clips = new Float32Array(MAX * 4), ra = new Float32Array(MAX * 2);
  let els = [];
  const radCache = new WeakMap();
  function collect() {
    if (!els.length || !els[0].isConnected) els = Array.from(document.querySelectorAll(SEL));
    let n = 0, sig = '';
    for (const el of els) {
      if (n >= MAX) break;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < -40 || r.top > H + 40) continue;
      let alpha = 1, cx0 = -1e5, cy0 = -1e5, cx1 = 1e5, cy1 = 1e5;
      if (el.classList.contains('nested-btn')) {
        // Кнопки всередині картки видно лише у відкритій картці і в межах її "шухляди"
        const card = el.closest('.link-card');
        if (!card || !card.classList.contains('is-open')) continue;
        const tray = el.closest('.inner-tray');
        if (tray) { const t = tray.getBoundingClientRect(); cx0 = t.left; cy0 = t.top; cx1 = t.right; cy1 = t.bottom; if (t.height < 2) continue; }
        alpha = parseFloat(getComputedStyle(el).opacity) || 0;
        if (alpha < 0.02) continue;
      }
      let rad = radCache.get(el);
      if (rad === undefined) { rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0; radCache.set(el, rad); }
      rects.set([r.left, r.top, r.width, r.height], n * 4);
      clips.set([cx0, cy0, cx1, cy1], n * 4);
      ra.set([rad, alpha], n * 2);
      sig += `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0},${(alpha * 20) | 0};`;
      n++;
    }
    return { n, sig };
  }

  // ---------- Кадр ----------
  function frame(now) {
    raf = null;
    if (!isAqua() || document.hidden || root.classList.contains('site-wrecked')) {
      if (root.classList.contains('site-wrecked')) root.classList.remove('lg-gl');
      return;
    }
    const { n, sig } = collect();
    const max = Math.max(1, root.scrollHeight - H);
    const prog = Math.min(1, Math.max(0, (window.scrollY || 0) / max));
    const sigAll = sig + '|' + prog.toFixed(4);
    // Градієнт переливається повільно — фон оновлюємо ~15 разів/с, а при гортанні/русі — щокадру
    const needBg = !lastBg || now - lastBg > 66 || sigAll !== lastSig;
    if (needBg || sigAll !== lastSig) {
      if (needBg) {
        lastBg = now;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, BW, BH);
        gl.useProgram(progBg.p);
        gl.uniform2f(progBg.u.uView, W, H);
        gl.uniform1f(progBg.u.uTime, (now - t0) / 1000);
        gl.uniform1f(progBg.u.uProg, prog);
        gl.uniform1f(progBg.u.uHasPhoto, photoTex ? 1 : 0);
        if (photo) gl.uniform2f(progBg.u.uPhotoSize, photo.naturalWidth, photo.naturalHeight);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, photoTex);
        gl.uniform1i(progBg.u.uPhoto, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(progGlass.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.uniform1i(progGlass.u.uBg, 0);
      gl.uniform2f(progGlass.u.uView, W, H);
      gl.uniform1f(progGlass.u.uMaxLod, 3.2);
      gl.uniform1i(progGlass.u.uN, n);
      gl.uniform4fv(progGlass.u.uRect, rects);
      gl.uniform4fv(progGlass.u.uClip, clips);
      gl.uniform2fv(progGlass.u.uRA, ra);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lastSig = sigAll;
    }
    raf = requestAnimationFrame(frame);
  }

  function kick() { if (!raf && gl && !failed) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }

  function onTheme() {
    if (!isAqua() || failed) { stop(); return; }
    if (!started) {
      started = true;
      try { init(); } catch (e) { failed = true; root.classList.remove('lg-gl'); if (canvas) canvas.remove(); return; }
    }
    root.classList.add('lg-gl');
    lastBg = 0;
    kick();
  }

  new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  onTheme();
})();
