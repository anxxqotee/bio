// Пасхалка: 3D-режим — модель iPhone 15 Pro з картинкою на екрані.
// Фізика як у "Киданні", тільки в 3D: тверде тіло з вагою і моментом інерції,
// кути б'ються об підлогу і стінки, хапаєш за точку — телефон висить на пальці,
// відпускаєш — летить по інерції. Тягнеш по фону — камера облітає сцену.
// three.js і модель підвантажуються лише після натискання "3D".
(() => {
  const overlay = document.getElementById('easterOverlay');
  const canvas = document.getElementById('egg3dCanvas');
  const btn = document.getElementById('egg3dToggle');
  const label = document.getElementById('egg3dLabel');
  const srcImg = document.querySelector('.easter-img');
  if (!overlay || !canvas || !btn || !srcImg) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fun = () => window.EggFun;
  const sound = (n, ...a) => { if (window.easterSound && window.easterSound[n]) window.easterSound[n](...a); };

  let THREE = null, GLTFLoader = null, RoomEnvironment = null;
  let ready = false, loading = false, on = false;
  let renderer, scene, camera, raycaster, phone, floorMesh;
  let rafId = null, prevT = 0;

  // ---------- Тверде тіло ----------
  const PHONE_H = 3.2;                       // висота телефона у світових одиницях
  let B = null;                              // { pos, vel, quat, w, half, invI }
  // Важкий, як справжній: швидко падає, слабко відскакує, сильне тертя
  const GRAV = 24;
  const RESTITUTION = 0.26, FRICTION = 0.65;

  // ---------- Пошкодження ----------
  const REPAIR_AFTER = 15000;   // через скільки мс після останнього удару починається відновлення
  const deformMeshes = [];      // { mesh, orig: Float32Array, entries: [] }
  const dents = [];             // { amp, entries: [{m, cx,cy,cz, dx,dy,dz, inv, k}] }
  let lastHitAt = 0, deformDirty = false, crackAlpha = 0, wasDamaged = false;
  let screen = null;            // { base, crack, out, ctx, tex }

  // ---------- Сцена й камера ----------
  let FLOOR = -2, XW = 2, ZW = 2.2, TOP = 4;
  let camYaw = 0, camPitch = 0.42, camR = 12, vYaw = 0, vPitch = 0;
  let tiltX = 0, tiltY = 0, gx = 0, gy = 0, baseBeta = null;
  const target = { x: 0, y: -0.5, z: 0 };

  // ---------- Взаємодія ----------
  let mode = null;                           // 'carry' | 'orbit'
  let carry = null;                          // { a: локальна точка, plane, goal }
  let startPt = null, lastPt = null, downTime = 0, moved = false;
  const tracker = makeVelTracker();
  let lastFaceSign = 1, lastImpact = 0, crackHits = 0;

  const onOrient = (e) => {
    if (e.beta == null || e.gamma == null) return;
    if (baseBeta === null) baseBeta = e.beta;
    tiltX = clamp((e.beta - baseBeta) * 0.01, -0.35, 0.35);
    tiltY = clamp(e.gamma * 0.01, -0.35, 0.35);
  };

  // ---------- Екран телефона: картинка на розмитому фоні ----------
  function screenTexture() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 1386;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const iw = srcImg.naturalWidth || 1349, ih = srcImg.naturalHeight || 600;
    // Розмитий фон на весь екран
    try { g.filter = 'blur(36px) brightness(0.7) saturate(1.3)'; } catch (e) {}
    const cs = Math.max(c.width / iw, c.height / ih) * 1.1;
    g.drawImage(srcImg, (c.width - iw * cs) / 2, (c.height - ih * cs) / 2, iw * cs, ih * cs);
    try { g.filter = 'none'; } catch (e) {}
    // Сама картинка по ширині, по центру
    const s = (c.width - 40) / iw;
    const w = iw * s, h = ih * s, x = 20, y = (c.height - h) / 2;
    g.save();
    g.beginPath();
    g.roundRect ? g.roundRect(x, y, w, h, 28) : g.rect(x, y, w, h);
    g.clip();
    g.drawImage(srcImg, x, y, w, h);
    g.restore();
    // Годинник, як на екрані блокування
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '600 120px -apple-system, "SF Pro Display", Roboto, sans-serif';
    g.textAlign = 'center';
    g.fillText('9:41', c.width / 2, 300);
    // Окремий шар для тріщин і підсумкове полотно
    const crack = document.createElement('canvas');
    crack.width = c.width; crack.height = c.height;
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const t = new THREE.CanvasTexture(out);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    screen = { base: c, crack, out, ctx, tex: t };
    return t;
  }

  function composeScreen() {
    if (!screen) return;
    const { ctx, base, crack, out, tex } = screen;
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);
    if (crackAlpha > 0.01) {
      ctx.globalAlpha = crackAlpha;
      ctx.drawImage(crack, 0, 0);
      ctx.globalAlpha = 1;
    }
    tex.needsUpdate = true;
  }

  // Тріщина-"павутинка": промені з ламаними лініями і кілька кілець
  function drawCrack(u, v, power) {
    const g = screen.crack.getContext('2d');
    const W = screen.crack.width, H = screen.crack.height;
    const x0 = u * W, y0 = v * H;
    const rays = 7 + Math.round(power * 9);
    const len = 160 + power * 520;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const paths = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + Math.random() * 0.5;
      let x = x0, y = y0, d = 0;
      const pts = [[x, y]];
      const L = len * (0.5 + Math.random() * 0.7);
      while (d < L) {
        const step = 18 + Math.random() * 34;
        const aa = a + (Math.random() - 0.5) * 0.6;
        x += Math.cos(aa) * step; y += Math.sin(aa) * step; d += step;
        pts.push([x, y]);
      }
      paths.push(pts);
    }
    const stroke = (w, col) => {
      g.strokeStyle = col; g.lineWidth = w;
      paths.forEach((pts) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); });
    };
    stroke(5, 'rgba(0,0,0,0.35)');
    stroke(2, 'rgba(255,255,255,0.85)');
    // Кільця між променями
    const rings = 1 + Math.round(power * 3);
    for (let r = 1; r <= rings; r++) {
      const rad = (len / (rings + 1)) * r * (0.6 + Math.random() * 0.3);
      g.beginPath();
      for (let k = 0; k <= rays; k++) {
        const a = (k / rays) * Math.PI * 2;
        const rr = rad * (0.85 + Math.random() * 0.3);
        const x = x0 + Math.cos(a) * rr, y = y0 + Math.sin(a) * rr;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    // Місце удару — побите скло
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.arc(x0, y0, 10 + power * 18, 0, Math.PI * 2); g.fill();
  }

  // Вм'ятина: точка удару і напрям у координатах кожної деталі моделі (тому вона "прилипає" до корпусу)
  function addDent(worldPoint, worldDir, depth) {
    const entries = [];
    const p2 = worldPoint.clone().add(worldDir);
    const sigmaWorld = 0.35 + depth * 2;
    for (const m of deformMeshes) {
      const c = m.mesh.worldToLocal(worldPoint.clone());
      const e = m.mesh.worldToLocal(p2.clone()).sub(c).normalize();
      const scale = m.mesh.matrixWorld.getMaxScaleOnAxis() || 1;
      const sig = sigmaWorld / scale;
      const entry = { cx: c.x, cy: c.y, cz: c.z, dx: e.x, dy: e.y, dz: e.z, inv: 1 / (2 * sig * sig), k: 1 / scale, cut: 9 * sig * sig };
      m.entries.push(entry);
      entries.push({ m, entry });
    }
    dents.push({ amp: depth, entries });
    // Не більше 8 вм'ятин — найстаріша "зливається"
    if (dents.length > 8) {
      const old = dents.shift();
      old.entries.forEach(({ m, entry }) => { m.entries.splice(m.entries.indexOf(entry), 1); });
    }
    deformDirty = true;
  }

  function applyDeform() {
    for (const m of deformMeshes) {
      const pos = m.mesh.geometry.attributes.position;
      const a = pos.array, o = m.orig;
      if (!m.entries.length) {
        if (m.dirty) { a.set(o); pos.needsUpdate = true; m.dirty = false; }
        continue;
      }
      const list = m.entries.map((en) => ({ ...en, amp: en.dent ? en.dent.amp : 0 }));
      for (let i = 0; i < a.length; i += 3) {
        const x = o[i], y = o[i + 1], z = o[i + 2];
        let ox = 0, oy = 0, oz = 0;
        for (const en of list) {
          const ddx = x - en.cx, ddy = y - en.cy, ddz = z - en.cz;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > en.cut) continue;
          const f = Math.exp(-d2 * en.inv) * en.amp * en.k;
          ox += en.dx * f; oy += en.dy * f; oz += en.dz * f;
        }
        a[i] = x + ox; a[i + 1] = y + oy; a[i + 2] = z + oz;
      }
      pos.needsUpdate = true;
      m.dirty = true;
    }
  }

  // Удар: тріщини на екрані (якщо вдарився сильно) і вм'ятина в точці контакту
  let enabledAt = 0;
  function damage(contactWorld, normalWorld, impact) {
    // Вхідне падіння не ламає телефон
    if (impact < 5 || performance.now() - enabledAt < 2500) return;
    const k = Math.min((impact - 5) / 14, 1);
    lastHitAt = performance.now();
    wasDamaged = true;
    addDent(contactWorld, normalWorld, 0.03 + k * 0.11);
    dents[dents.length - 1].entries.forEach(({ entry }) => { entry.dent = dents[dents.length - 1]; });
    // Тріщини — у куті екрана, найближчому до удару
    if (screen && impact > 7) {
      const local = contactWorld.clone().sub(B.pos).applyQuaternion(B.quat.clone().invert());
      const u = clamp(0.5 - (local.x / B.half.x) * 0.42, 0.06, 0.94);
      const v = clamp(0.5 - (local.y / B.half.y) * 0.44, 0.05, 0.95);
      drawCrack(u, v, k);
      crackAlpha = 1;
      composeScreen();
    }
    if (impact > 7) {
      sound('crack', k);
      // Секрет: 5 сильних ударів, поки телефон не встиг відновитись
      crackHits++;
      if (crackHits >= 5 && fun()) fun().secret('heli');
    }
  }

  // Поступове відновлення через 15 с після останнього удару
  function repair(dt) {
    if (!wasDamaged || performance.now() - lastHitAt < REPAIR_AFTER) return;
    crackHits = 0;
    const f = Math.exp(-dt * 1.4);
    let alive = false;
    dents.forEach((d) => { d.amp *= f; if (d.amp > 0.002) alive = true; });
    if (dents.length) deformDirty = true;
    if (crackAlpha > 0) { crackAlpha = Math.max(0, crackAlpha - dt * 0.45); composeScreen(); if (crackAlpha > 0) alive = true; }
    if (!alive) {
      // Як новий
      while (dents.length) dents.pop();
      deformMeshes.forEach((m) => { m.entries.length = 0; });
      deformDirty = true;
      crackAlpha = 0;
      if (screen) { screen.crack.getContext('2d').clearRect(0, 0, screen.crack.width, screen.crack.height); composeScreen(); }
      wasDamaged = false;
      sound('chime');
      Haptics.pattern([10, 40, 10]);
    }
  }

  // ---------- Побудова сцени ----------
  async function build() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    raycaster = new THREE.Raycaster();

    // Студійне освітлення з відблисками на металі
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-3, 9, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    sun.shadow.radius = 5;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    room = new THREE.Group();
    scene.add(room);
    floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.45 }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Модель телефона
    const gltf = await new GLTFLoader().loadAsync('models/iphone15pro.glb');
    const model = gltf.scene;
    let screenMesh = null, bestArea = 0;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.geometry = o.geometry.clone();
      deformMeshes.push({ mesh: o, orig: new Float32Array(o.geometry.attributes.position.array), entries: [], dirty: false });
      // Екран — велика пласка деталь зі світним матеріалом
      if (o.material && o.material.emissiveMap) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        const area = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y);
        if (area > bestArea) { bestArea = area; screenMesh = o; }
      }
    });
    if (screenMesh) {
      // Розтягуємо нашу картинку на всю площу екрана за його рамкою
      const geo = screenMesh.geometry;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const pos = geo.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = 1 - (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x);  // екран дивиться в -z, тож дзеркалимо
        uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      screenMesh.material = new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false });
    }

    // Центруємо, масштабуємо і повертаємо екраном до камери
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = PHONE_H / size.y;
    model.position.sub(center);
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(s);
    holder.rotation.y = Math.PI;
    phone = new THREE.Group();
    phone.add(holder);
    scene.add(phone);

    const half = new THREE.Vector3(size.x * s / 2, size.y * s / 2, size.z * s / 2);
    const m = 1;
    const I = new THREE.Vector3(
      (m / 12) * (4 * half.y * half.y + 4 * half.z * half.z),
      (m / 12) * (4 * half.x * half.x + 4 * half.z * half.z),
      (m / 12) * (4 * half.x * half.x + 4 * half.y * half.y)
    );
    B = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), w: new THREE.Vector3(),
      half, invI: new THREE.Vector3(1 / I.x, 1 / I.y, 1 / I.z)
    };

    resize();
    window.addEventListener('resize', resize);
    ready = true;
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    // Телефон займає приблизно 40% висоти екрана
    camR = PHONE_H / 0.4 / (2 * tanH);
    const halfH = camR * tanH, halfW = halfH * camera.aspect;
    XW = Math.max(halfW * 0.92, 1.8);
    ZW = Math.max(2.4, XW * 0.8);
    FLOOR = -halfH * 0.62;
    TOP = halfH * 1.4;
    target.y = FLOOR * 0.35;
    if (floorMesh) floorMesh.position.y = FLOOR;
    buildRoom();
    placeCamera();
  }

  // Видима "кімната": підлога з сіткою, задня й бічні стіни, світні ребра
  let room = null;
  function buildRoom() {
    if (!room) return;
    while (room.children.length) {
      const c = room.children.pop();
      c.geometry && c.geometry.dispose();
    }
    const W = XW * 2, D = ZW * 2, Hh = TOP - FLOOR;
    const edgeCol = 0x7fd6ff;
    // Підлога
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({
      color: 0x1a2230, roughness: 0.85, metalness: 0.05, transparent: true, opacity: 0.55
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR - 0.002, 0);
    floor.receiveShadow = true;
    room.add(floor);
    const grid = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D) / 0.5), edgeCol, edgeCol);
    grid.scale.set(W / Math.max(W, D), 1, D / Math.max(W, D));
    grid.position.y = FLOOR;
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    room.add(grid);
    // Стіни: задня і бічні (передню не малюємо — через неї дивимось)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.9, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), wallMat);
    back.position.set(0, FLOOR + Hh / 2, -ZW);
    back.receiveShadow = true;
    room.add(back);
    [-1, 1].forEach((sx) => {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(D, Hh), wallMat);
      side.rotation.y = Math.PI / 2;
      side.position.set(sx * XW, FLOOR + Hh / 2, 0);
      room.add(side);
    });
    // Світні ребра кімнати
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, Hh, D)),
      new THREE.LineBasicMaterial({ color: edgeCol, transparent: true, opacity: 0.55 })
    );
    edges.position.set(0, FLOOR + Hh / 2, 0);
    room.add(edges);
  }

  function placeCamera() {
    const yaw = 0, pitch = 0.42;   // камера нерухома
    camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * camR,
      target.y + Math.sin(pitch) * camR,
      target.z + Math.cos(yaw) * Math.cos(pitch) * camR
    );
    camera.lookAt(target.x, target.y, target.z);
  }

  const unitsPerPx = () => (2 * camR * Math.tan((camera.fov * Math.PI) / 360)) / window.innerHeight;

  // ---------- Механіка твердого тіла ----------
  const _v1 = () => new THREE.Vector3();

  // Обернений тензор інерції у світових координатах, застосований до вектора
  function invInertiaWorld(x) {
    const q = B.quat;
    const local = x.clone().applyQuaternion(q.clone().invert());
    local.set(local.x * B.invI.x, local.y * B.invI.y, local.z * B.invI.z);
    return local.applyQuaternion(q);
  }

  function applyImpulse(r, J) {
    B.vel.add(J);
    B.w.add(invInertiaWorld(new THREE.Vector3().crossVectors(r, J)));
  }

  function corners() {
    const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const r = new THREE.Vector3(sx * B.half.x, sy * B.half.y, sz * B.half.z).applyQuaternion(B.quat);
      out.push(r);
    }
    return out;
  }

  const PLANES = () => [
    { n: new THREE.Vector3(0, 1, 0), d: FLOOR, floor: true },
    { n: new THREE.Vector3(0, -1, 0), d: -TOP },
    { n: new THREE.Vector3(1, 0, 0), d: -XW },
    { n: new THREE.Vector3(-1, 0, 0), d: -XW },
    { n: new THREE.Vector3(0, 0, 1), d: -ZW },
    { n: new THREE.Vector3(0, 0, -1), d: -ZW }
  ];

  function collide(carrying) {
    let onFloor = false;
    for (const P of PLANES()) {
      let worst = null, depth = 0;
      for (const r of corners()) {
        const pen = P.d - (B.pos.x + r.x) * P.n.x - (B.pos.y + r.y) * P.n.y - (B.pos.z + r.z) * P.n.z;
        if (pen > depth) { depth = pen; worst = r; }
      }
      if (!worst) continue;
      if (P.floor) onFloor = true;
      B.pos.addScaledVector(P.n, depth);
      if (carrying) continue;
      const vp = B.vel.clone().add(new THREE.Vector3().crossVectors(B.w, worst));
      const vn = vp.dot(P.n);
      if (vn >= 0) continue;
      const rn = new THREE.Vector3().crossVectors(worst, P.n);
      const k = 1 + P.n.dot(new THREE.Vector3().crossVectors(invInertiaWorld(rn), worst));
      const e = vn < -1.5 ? RESTITUTION : 0;
      const j = (-(1 + e) * vn) / k;
      applyImpulse(worst, P.n.clone().multiplyScalar(j));
      // Тертя
      const vp2 = B.vel.clone().add(new THREE.Vector3().crossVectors(B.w, worst));
      const vt = vp2.clone().addScaledVector(P.n, -vp2.dot(P.n));
      const vtl = vt.length();
      if (vtl > 1e-5) {
        const t = vt.divideScalar(vtl);
        const rt = new THREE.Vector3().crossVectors(worst, t);
        const kt = 1 + t.dot(new THREE.Vector3().crossVectors(invInertiaWorld(rt), worst));
        const jt = Math.min(vtl / kt, FRICTION * j);
        applyImpulse(worst, t.multiplyScalar(-jt));
      }
      // Звук і вібрація від удару
      const now = performance.now();
      if (-vn > 5 && now - lastImpact > 120) damage(B.pos.clone().add(worst), P.n.clone(), -vn);
      if (-vn > 2 && now - lastImpact > 60) {
        lastImpact = now;
        const kk = Math.min(-vn / 14, 1);
        sound('clack', kk);
        Haptics.tick(Math.round(8 + kk * 32));
        if (fun()) fun().stat('bounces');
      }
    }
    return onFloor;
  }

  function stepPhysics(dt) {
    const STEPS = 4;
    const h = dt / STEPS;
    let onFloor = false;
    const carrying = mode === 'carry' && carry;
    for (let s = 0; s < STEPS; s++) {
      if (carrying) {
        // Пружина від точки, за яку тримаємо, до пальця (критичне гасіння)
        const r = carry.a.clone().applyQuaternion(B.quat);
        const p = B.pos.clone().add(r);
        const vp = B.vel.clone().add(new THREE.Vector3().crossVectors(B.w, r));
        const F = carry.goal.clone().sub(p).multiplyScalar(110).addScaledVector(vp, -20);
        B.vel.addScaledVector(F, h);
        B.vel.y -= GRAV * 0.5 * h;   // важкий — в руці провисає
        B.w.add(invInertiaWorld(new THREE.Vector3().crossVectors(r, F)).multiplyScalar(h));
        B.w.multiplyScalar(Math.pow(0.02, h));
      } else {
        B.vel.y -= GRAV * h;
        B.vel.multiplyScalar(Math.pow(0.9, h));
        B.w.multiplyScalar(Math.pow(0.7, h));
      }
      B.pos.addScaledVector(B.vel, h);
      const wl = B.w.length();
      if (wl > 1e-6) {
        B.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(B.w.clone().divideScalar(wl), wl * h)).normalize();
      }
      onFloor = collide(carrying) || onFloor;
    }
    // Спокій на підлозі — тільки коли телефон лежить пласко (екраном вгору або вниз).
    // Якщо застиг на ребрі — легенько підштовхуємо, щоб упав, як справжній.
    if (onFloor && !carrying && B.vel.length() < 0.25 && B.w.length() < 0.3) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(B.quat);
      if (Math.abs(n.y) > 0.97) {
        if (B.vel.length() < 0.06 && B.w.length() < 0.08) { B.vel.set(0, 0, 0); B.w.set(0, 0, 0); }
      } else {
        const axis = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, n.y >= 0 ? 1 : -1, 0));
        if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
        B.w.addScaledVector(axis.normalize(), 1.2 * dt);
      }
    }
  }

  // ---------- Кадр ----------
  function frame(t) {
    const dt = Math.min((t - prevT) / 1000, 0.033);
    prevT = t;
    if (mode !== 'orbit') {
      camYaw += vYaw * dt;
      camPitch = clamp(camPitch + vPitch * dt, 0.08, 1.25);
      vYaw *= Math.pow(0.12, dt);
      vPitch *= Math.pow(0.12, dt);
    }
    gx += (tiltX - gx) * Math.min(1, dt * 8);
    gy += (tiltY - gy) * Math.min(1, dt * 8);
    placeCamera();

    stepPhysics(dt);
    phone.position.copy(B.pos);
    phone.quaternion.copy(B.quat);
    phone.updateMatrixWorld(true);
    repair(dt);
    if (deformDirty) { deformDirty = false; applyDeform(); }

    // Досягнення: перевороти екраном до камери
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(B.quat);
    const sign = n.dot(camera.position.clone().sub(B.pos)) >= 0 ? 1 : -1;
    if (sign !== lastFaceSign) { lastFaceSign = sign; if (fun()) fun().stat('flips'); }

    renderer.render(scene, camera);
    rafId = on ? requestAnimationFrame(frame) : null;
  }

  function drop() {
    // Телефон падає згори з обертом
    B.pos.set(0, TOP * 0.7, 0);
    // Екраном догори, з легким закрутом довкола вертикалі — щоб приземлився картинкою до глядача
    B.quat.setFromEuler(new THREE.Euler(-1.15, 0.5, 0.1));
    B.vel.set(0, -2, 0);
    B.w.set(reduceMotion ? 0 : 0.4, reduceMotion ? 0 : 2.2, reduceMotion ? 0 : 0.2);
  }

  // ---------- Увімкнення / вимкнення ----------
  async function enable() {
    if (loading) return;
    if (!ready) {
      loading = true;
      btn.classList.add('is-loading');
      label.textContent = '...';
      try {
        THREE = await import('./vendor/three.module.min.js');
        ({ GLTFLoader } = await import('./vendor/GLTFLoader.js'));
        ({ RoomEnvironment } = await import('./vendor/RoomEnvironment.js'));
        await build();
      } catch (e) {
        console.error(e);
        loading = false;
        btn.classList.remove('is-loading');
        label.textContent = 'Без 3D';
        setTimeout(() => { label.textContent = '3D'; }, 1500);
        return;
      }
      loading = false;
      btn.classList.remove('is-loading');
    }

    on = true;
    camYaw = 0; camPitch = 0.42; vYaw = vPitch = 0;
    baseBeta = null;
    overlay.classList.add('is-3d');
    btn.setAttribute('aria-pressed', 'true');
    label.textContent = '2D';
    resize();
    enabledAt = performance.now();
    drop();
    // Акселерометр/гіроскоп у 3D не використовуємо
    Haptics.pattern([10, 40, 10, 40, 20]);
    if (fun()) { fun().setFree(false, true); fun().stat('threeD'); fun().askMotion(); }
    if (!rafId) { prevT = performance.now(); rafId = requestAnimationFrame(frame); }
  }

  function disable() {
    on = false;
    mode = null;
    carry = null;
    window.removeEventListener('deviceorientation', onOrient);
    tiltX = tiltY = 0;
    overlay.classList.remove('is-3d');
    btn.setAttribute('aria-pressed', 'false');
    label.textContent = '3D';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (on) { disable(); Haptics.tick(12); } else enable();
  });
  overlay.addEventListener('eggclose', () => { if (on) disable(); });

  // Струс телефона — телефон на екрані підкидає
  // Акселерометр у 3D вимкнено: струс телефона тут нічого не робить
  window.__egg3dShake = () => on && ready;

  // ---------- Дотики ----------
  function ray(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!on || !ready) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    startPt = lastPt = { x: e.clientX, y: e.clientY, t: performance.now() };
    downTime = performance.now();
    moved = false;
    tracker.reset();
    tracker.push(e.clientX, e.clientY);
    const hit = ray(e.clientX, e.clientY).intersectObject(phone, true)[0];
    if (hit) {
      mode = 'carry';
      const fwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
      carry = {
        a: hit.point.clone().sub(B.pos).applyQuaternion(B.quat.clone().invert()),
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, hit.point),
        goal: hit.point.clone()
      };
      if (window.easterQuote) window.easterQuote();
      Haptics.tick(10);
      sound('pick');
    } else {
      mode = null;   // тягнути по фону нічого не робить — камера нерухома
      vYaw = vPitch = 0;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!on || !mode || !lastPt) return;
    const now = performance.now();
    const dx = e.clientX - lastPt.x, dy = e.clientY - lastPt.y;
    if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 6) moved = true;
    tracker.push(e.clientX, e.clientY);
    if (mode === 'carry') {
      const p = ray(e.clientX, e.clientY).ray.intersectPlane(carry.plane, new THREE.Vector3());
      if (p) {
        // Не далі за стінки
        p.x = clamp(p.x, -XW, XW); p.z = clamp(p.z, -ZW, ZW); p.y = clamp(p.y, FLOOR, TOP);
        carry.goal.copy(p);
      }
    } else {
      const dts = Math.max((now - lastPt.t) / 1000, 0.001);
      camYaw -= dx * 0.008;
      camPitch = clamp(camPitch + dy * 0.006, 0.08, 1.25);
      vYaw = vYaw * 0.6 + ((-dx * 0.008) / dts) * 0.4;
      vPitch = vPitch * 0.6 + ((dy * 0.006) / dts) * 0.4;
    }
    lastPt = { x: e.clientX, y: e.clientY, t: now };
  });

  const end = () => {
    if (!mode) return;
    const was = mode;
    mode = null;
    const quick = !moved && performance.now() - downTime < 300;
    if (was === 'carry') {
      carry = null;
      if (quick) {
        // Тап — телефон підстрибує
        B.vel.y += 6.5;
        B.w.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8));
        sound('whoosh', 0.2);
        Haptics.tick(12);
      } else {
        // Кидок по інерції: швидкість пальця у площині екрана + власна швидкість телефона
        const f = tracker.get();
        const upp = unitsPerPx();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const v = right.multiplyScalar(f.x * upp).add(up.multiplyScalar(-f.y * upp));
        if (v.length() > 22) v.setLength(22);
        B.vel.multiplyScalar(0.35).addScaledVector(v, 0.6);
        if (v.length() > 6) {
          if (fun()) { fun().stat('throws'); fun().counterHit(); }
          sound('whoosh', Math.min(v.length() / 20, 1));
          Haptics.pattern([20, 30, 12]);
        }
      }
    } else if (lastPt && performance.now() - lastPt.t > 80) {
      vYaw = vPitch = 0;
    }
    startPt = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
})();
