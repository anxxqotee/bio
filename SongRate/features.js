// SongRate — додаткові можливості: аватарки, режими (Рулетка, Батл треків, Вгадай трек, Сліпе оцінювання)
(() => {
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const esc = (v) => (typeof escapeHTML === 'function' ? escapeHTML(v) : String(v ?? ''));
  const toast = (t) => (typeof showToast === 'function' ? showToast(t) : null);

  // =====================================================================
  // АВАТАРКИ
  // =====================================================================
  const AVATAR_KEY = 'songrate_avatar';
  const avatarCache = new Map();   // userId -> dataURL | null
  let pendingFill = new Map();     // userId -> [{img, name}]
  let fillTimer = null;

  function hashStr(str) {
    let h = 0;
    for (const c of String(str || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return h;
  }

  // Автоматична аватарка: градієнт + перша літера імені
  function generatedAvatar(name) {
    const clean = String(name || 'U').replace(/^@+/, '').trim() || 'U';
    const letter = [...clean][0].toUpperCase();
    const h = hashStr(clean) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${h},75%,62%)"/><stop offset="1" stop-color="hsl(${(h + 70) % 360},70%,42%)"/>
      </linearGradient></defs>
      <rect width="100" height="100" fill="url(#g)"/>
      <text x="50" y="52" font-family="Segoe UI, Roboto, sans-serif" font-size="46" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${letter.replace(/[<&>"]/g, '')}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  const myAvatar = () => LS.get(AVATAR_KEY, null) || generatedAvatar(State.username);

  function renderMyAvatar() {
    const url = myAvatar();
    const profileImg = $('profile-avatar-img');
    if (profileImg) profileImg.src = url;
    const headerBtn = $('btn-profile-toggle');
    if (headerBtn) {
      const img = headerBtn.querySelector('img');
      if (img) {
        img.src = url;
        img.classList.remove('svg-icon');
        img.classList.add('header-avatar');
      }
    }
    if (State.user) avatarCache.set(State.user.id, LS.get(AVATAR_KEY, null));
  }

  // Підставляє аватарку будь-якого користувача (з таблиці profiles), або згенеровану
  function fillAvatar(img, userId, name) {
    if (!img) return;
    img.onerror = () => { img.onerror = null; img.src = generatedAvatar(name); };
    if (State.user && userId && String(userId) === String(State.user.id)) { img.src = myAvatar(); return; }
    img.src = generatedAvatar(name);
    if (!userId || !supabaseClient) return;
    if (avatarCache.has(userId)) {
      const a = avatarCache.get(userId);
      if (a) img.src = a;
      return;
    }
    if (!pendingFill.has(userId)) pendingFill.set(userId, []);
    pendingFill.get(userId).push(img);
    clearTimeout(fillTimer);
    fillTimer = setTimeout(flushFill, 40);
  }

  async function flushFill() {
    const batch = pendingFill;
    pendingFill = new Map();
    const ids = [...batch.keys()];
    if (!ids.length) return;
    try {
      const { data, error } = await supabaseClient.from('profiles').select('id, avatar').in('id', ids);
      if (error) throw error;
      const found = new Map((data || []).map((r) => [String(r.id), r.avatar]));
      ids.forEach((id) => {
        const a = found.get(String(id)) || null;
        avatarCache.set(id, a);
        if (a) batch.get(id).forEach((img) => { img.src = a; });
      });
    } catch (e) {
      ids.forEach((id) => avatarCache.set(id, null)); // таблиці може ще не бути — не повторюємо запит
    }
  }

  async function pushProfile() {
    if (!supabaseClient || !State.user) return;
    try {
      await supabaseClient.from('profiles').upsert({
        id: State.user.id,
        username: State.username,
        avatar: LS.get(AVATAR_KEY, null),
        updated_at: new Date().toISOString()
      });
    } catch (e) {}
  }

  async function onAuthChange(user) {
    renderMyAvatar();
    if (!user || !supabaseClient) return;
    try {
      const { data } = await supabaseClient.from('profiles').select('avatar').eq('id', user.id).maybeSingle();
      const local = LS.get(AVATAR_KEY, null);
      if (data && data.avatar && !local) {
        LS.set(AVATAR_KEY, data.avatar);  // зайшов з іншого пристрою — підтягуємо свою аватарку
        renderMyAvatar();
      } else {
        pushProfile();
      }
    } catch (e) {}
  }

  // ---------- Обрізка аватарки ----------
  const crop = { img: null, zoom: 1, ox: 0, oy: 0 };
  const CROP_SIZE = 560;

  function cropBaseScale() {
    return Math.max(CROP_SIZE / crop.img.width, CROP_SIZE / crop.img.height);
  }

  function clampCrop() {
    const s = cropBaseScale() * crop.zoom;
    const w = crop.img.width * s, h = crop.img.height * s;
    const maxX = Math.max(0, (w - CROP_SIZE) / 2), maxY = Math.max(0, (h - CROP_SIZE) / 2);
    crop.ox = Math.max(-maxX, Math.min(maxX, crop.ox));
    crop.oy = Math.max(-maxY, Math.min(maxY, crop.oy));
  }

  function drawCrop(ctx, size) {
    const k = size / CROP_SIZE;
    const s = cropBaseScale() * crop.zoom * k;
    const w = crop.img.width * s, h = crop.img.height * s;
    ctx.fillStyle = '#12101a';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(crop.img, (size - w) / 2 + crop.ox * k, (size - h) / 2 + crop.oy * k, w, h);
  }

  function redrawCrop() {
    if (!crop.img) return;
    clampCrop();
    drawCrop($('avatar-crop-canvas').getContext('2d'), CROP_SIZE);
  }

  function openCropWith(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Це не схоже на картинку'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      crop.img = img; crop.zoom = 1; crop.ox = 0; crop.oy = 0;
      $('avatar-zoom').value = '1';
      $('modal-avatar').classList.remove('hidden');
      redrawCrop();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { toast('Не вдалося відкрити це фото'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function initAvatarUI() {
    const fileInput = $('avatar-file-input');
    const modal = $('modal-avatar');
    if (!fileInput || !modal) return;
    $('btn-avatar-edit').addEventListener('click', () => fileInput.click());
    $('btn-avatar-pick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { openCropWith(fileInput.files[0]); fileInput.value = ''; });

    const close = () => modal.classList.add('hidden');
    $('btn-close-avatar').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    $('avatar-zoom').addEventListener('input', (e) => { crop.zoom = Number(e.target.value); redrawCrop(); });

    const canvas = $('avatar-crop-canvas');
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!crop.img) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy, k: CROP_SIZE / canvas.getBoundingClientRect().width };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      crop.ox = drag.ox + (e.clientX - drag.x) * drag.k;
      crop.oy = drag.oy + (e.clientY - drag.y) * drag.k;
      redrawCrop();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // Колесо миші — масштаб
    canvas.addEventListener('wheel', (e) => {
      if (!crop.img) return;
      e.preventDefault();
      crop.zoom = Math.max(1, Math.min(3, crop.zoom - e.deltaY * 0.002));
      $('avatar-zoom').value = String(crop.zoom);
      redrawCrop();
    }, { passive: false });

    $('btn-avatar-save').addEventListener('click', () => {
      if (!crop.img) return;
      const out = document.createElement('canvas');
      out.width = out.height = 256;
      drawCrop(out.getContext('2d'), 256);
      const data = out.toDataURL('image/jpeg', 0.85);
      LS.set(AVATAR_KEY, data);
      renderMyAvatar();
      pushProfile();
      close();
      toast('Аватарку збережено!');
      vibrate(15);
    });
    $('btn-avatar-reset').addEventListener('click', () => {
      LS.del(AVATAR_KEY);
      renderMyAvatar();
      pushProfile();
      close();
      toast('Аватарку прибрано');
    });
  }

  // =====================================================================
  // РЕЖИМИ
  // =====================================================================
  const BLIND_KEY = 'songrate_blind';
  const modeAudio = new Audio();
  modeAudio.preload = 'auto';
  let snippetTimer = null;

  function stopModeAudio() {
    clearTimeout(snippetTimer);
    modeAudio.pause();
    document.querySelectorAll('.is-audio-playing').forEach((el) => el.classList.remove('is-audio-playing'));
  }

  function playPreview(url, el, fromSec = 0, lengthSec = 0) {
    stopModeAudio();
    if (!url) { toast('Для цього треку немає прев\'ю'); return; }
    modeAudio.volume = State.volume ?? 0.8;
    if (modeAudio.getAttribute('src') !== url) modeAudio.src = url;
    const go = () => {
      try { modeAudio.currentTime = fromSec; } catch (e) {}
      modeAudio.play().catch(() => {});
      if (el) el.classList.add('is-audio-playing');
      if (lengthSec) snippetTimer = setTimeout(stopModeAudio, lengthSec * 1000);
    };
    if (modeAudio.readyState >= 1) go(); else modeAudio.addEventListener('loadedmetadata', go, { once: true });
  }
  modeAudio.addEventListener('ended', () => stopModeAudio());

  // Будь-який перехід між екранами зупиняє звук режимів
  if (typeof window.showView === 'function') {
    const origShowView = window.showView;
    window.showView = function (viewId, pushHistory) {
      stopModeAudio();
      document.body.classList.toggle('sr-blind-active', viewId === 'view-rating' && LS.get(BLIND_KEY, false));
      return origShowView.call(this, viewId, pushHistory);
    };
  }

  const MODES = [
    { id: 'roulette', emoji: '🎲', title: 'Рулетка', desc: 'Крутиш — і оцінюєш альбом, який випав' },
    { id: 'battle', emoji: '⚔️', title: 'Батл треків', desc: 'Треки альбому б\'ються попарно. Хто переможе?' },
    { id: 'quiz', emoji: '🎧', title: 'Вгадай трек', desc: '5 секунд уривку з твоїх оцінених треків і схожих' },
    { id: 'blind', emoji: '🙈', title: 'Сліпе оцінювання', desc: 'Без обкладинки і назв — тільки музика', toggle: true }
  ];

  function renderModes() {
    const grid = $('modes-grid');
    if (!grid) return;
    grid.innerHTML = '';
    MODES.forEach((m) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card frosted mode-' + m.id;
      const on = m.toggle && LS.get(BLIND_KEY, false);
      card.innerHTML = `
        <span class="mode-emoji">${m.emoji}</span>
        <span class="mode-title">${m.title}</span>
        <span class="mode-desc">${m.desc}</span>
        ${m.toggle ? `<span class="mode-switch ${on ? 'is-on' : ''}"><span></span></span>` : '<span class="mode-go">Грати →</span>'}
      `;
      card.addEventListener('click', () => onModeClick(m.id));
      grid.appendChild(card);
    });
  }

  function onModeClick(id) {
    vibrate(10);
    if (id === 'blind') {
      const on = !LS.get(BLIND_KEY, false);
      LS.set(BLIND_KEY, on);
      renderModes();
      document.body.classList.toggle('sr-blind-on', on);
      toast(on ? '🙈 Сліпе оцінювання увімкнено — обкладинку й назви побачиш у кінці' : 'Сліпе оцінювання вимкнено');
    } else if (id === 'roulette') {
      runRoulette();
    } else if (id === 'battle') {
      openPicker('⚔️ Батл треків: вибери альбом', startBattle);
    } else if (id === 'quiz') {
      if (window.SRSmart && SRSmart.startPersonalQuiz) SRSmart.startPersonalQuiz();
      else openPicker('🎧 Вгадай трек: вибери альбом', startQuiz);
    }
  }

  // ---------- Випадковий альбом ----------
  function artistPool() {
    try { return Object.values(GENRE_ARTIST_MAP).flat(); } catch (e) { return ['Tame Impala', 'Kendrick Lamar', 'Daft Punk', 'The Weeknd']; }
  }

  async function randomAlbums(n = 8) {
    const artists = shuffle(artistPool()).slice(0, 3);
    const lists = await Promise.all(artists.map((a) => MusicAPI.searchAlbums(a, 10)));
    const seen = new Set();
    return shuffle(lists.flat().filter((it) => {
      if (!it.collectionId || seen.has(it.collectionId) || (it.trackCount || 0) < 4) return false;
      seen.add(it.collectionId);
      return true;
    })).slice(0, n);
  }

  const art = (it, size = 600) => (it.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', `${size}x${size}bb`) : 'icons/album-placeholder.svg');

  // ---------- Рулетка ----------
  async function runRoulette() {
    const overlay = document.createElement('div');
    overlay.className = 'roulette-overlay';
    overlay.innerHTML = `
      <div class="roulette-card frosted">
        <div class="roulette-window"><div class="roulette-strip"></div></div>
        <div class="roulette-meta"><span class="roulette-title">Крутимо...</span><span class="roulette-artist"></span></div>
        <div class="roulette-actions hidden">
          <button class="btn btn-inactive" data-act="again">🎲 Ще раз</button>
          <button class="btn btn-inactive" data-act="open">Відкрити</button>
          <button class="btn btn-primary" data-act="rate">Оцінити</button>
        </div>
        <button class="icon-btn roulette-close" data-act="close" aria-label="Закрити"><img src="icons/close.svg" alt="" class="svg-icon"></button>
      </div>`;
    document.body.appendChild(overlay);
    const strip = overlay.querySelector('.roulette-strip');
    let chosen = null;

    const spin = async () => {
      overlay.querySelector('.roulette-actions').classList.add('hidden');
      overlay.querySelector('.roulette-title').textContent = 'Крутимо...';
      overlay.querySelector('.roulette-artist').textContent = '';
      const albums = await randomAlbums(10);
      if (!overlay.isConnected) return;
      if (!albums.length) { overlay.querySelector('.roulette-title').textContent = 'Не вдалося знайти альбоми'; return; }
      chosen = albums[albums.length - 1];
      // Стрічка обкладинок: кілька кіл і зупинка на вибраному
      const seq = [];
      for (let r = 0; r < 4; r++) seq.push(...albums);
      strip.style.transition = 'none';
      strip.style.transform = 'translateX(0)';
      strip.innerHTML = seq.map((a) => `<img src="${esc(art(a, 300))}" alt="" onerror="this.src='icons/album-placeholder.svg'">`).join('');
      void strip.offsetWidth;
      const imgW = strip.firstElementChild.getBoundingClientRect().width || 180;
      const cell = imgW + 16;
      const win = overlay.querySelector('.roulette-window').clientWidth;
      const target = (seq.length - 1) * cell - (win - imgW) / 2;
      strip.style.transition = 'transform 3.2s cubic-bezier(0.12, 0.7, 0.1, 1)';
      strip.style.transform = `translateX(${-target}px)`;
      // "Клацання" поки крутиться
      let ticks = 0;
      const tick = setInterval(() => { if (++ticks > 14) clearInterval(tick); vibrate(5); }, 180);
      setTimeout(() => {
        if (!overlay.isConnected) return;
        overlay.querySelector('.roulette-title').textContent = chosen.collectionName;
        overlay.querySelector('.roulette-artist').textContent = chosen.artistName;
        overlay.querySelector('.roulette-actions').classList.remove('hidden');
        strip.lastElementChild.classList.add('is-chosen');
        vibrate([20, 40, 30]);
      }, 3300);
    };

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (e.target === overlay || act === 'close') overlay.remove();
      else if (act === 'again') spin();
      else if (act === 'open' && chosen) { overlay.remove(); openAlbumPage(chosen.collectionId); }
      else if (act === 'rate' && chosen) { overlay.remove(); startAlbumRating(chosen.collectionId); }
    });
    spin();
  }

  // ---------- Вибір альбому ----------
  let pickerCb = null;
  let pickerSeq = 0;

  function openPicker(title, cb) {
    pickerCb = cb;
    $('picker-title').textContent = title;
    $('picker-input').value = '';
    $('modal-picker').classList.remove('hidden');
    renderPickerList(null);
    // Одразу кілька пропозицій
    const seq = ++pickerSeq;
    randomAlbums(6).then((list) => { if (seq === pickerSeq) renderPickerList(list, 'Можна вибрати з цих:'); });
    setTimeout(() => $('picker-input').focus(), 50);
  }

  function renderPickerList(list, caption) {
    const box = $('picker-results');
    if (list === null) { box.innerHTML = '<p class="item-sub">Шукаємо альбоми...</p>'; return; }
    if (!list.length) { box.innerHTML = '<p class="item-sub">Нічого не знайдено</p>'; return; }
    box.innerHTML = caption ? `<p class="item-sub picker-caption">${esc(caption)}</p>` : '';
    list.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'dropdown-item';
      row.innerHTML = `
        <img src="${esc(art(it, 200))}" alt="" onerror="this.onerror=null;this.src='icons/album-placeholder.svg'">
        <div class="item-info">
          <span class="item-title">${esc(it.collectionName)}</span>
          <span class="item-sub">${esc(it.artistName)} · ${it.trackCount || '?'} треків</span>
        </div>`;
      row.addEventListener('click', () => choosePicked(it.collectionId));
      box.appendChild(row);
    });
  }

  function choosePicked(id) {
    $('modal-picker').classList.add('hidden');
    const cb = pickerCb;
    pickerCb = null;
    if (cb) cb(id);
  }

  function initPicker() {
    const modal = $('modal-picker');
    if (!modal) return;
    const close = () => { modal.classList.add('hidden'); pickerCb = null; };
    $('btn-close-picker').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    let t = null;
    $('picker-input').addEventListener('input', (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (q.length < 2) return;
      t = setTimeout(async () => {
        const seq = ++pickerSeq;
        renderPickerList(null);
        const list = await MusicAPI.searchAlbums(q, 15);
        if (seq === pickerSeq) renderPickerList(list.filter((it) => (it.trackCount || 0) >= 2));
      }, 350);
    });
    $('btn-picker-random').addEventListener('click', async () => {
      const list = await randomAlbums(1);
      if (list[0]) choosePicked(list[0].collectionId); else toast('Не вдалося знайти альбом');
    });
    document.querySelectorAll('.mode-exit').forEach((b) => b.addEventListener('click', () => {
      stopModeAudio();
      showView('view-home');
    }));
  }

  async function loadAlbumForMode(id, minTracks) {
    toast('Завантажуємо альбом...');
    const album = await MusicAPI.getAlbumWithTracks(id);
    if (!album) { toast('Не вдалося завантажити альбом'); return null; }
    const playable = album.tracks.filter((t) => t.previewUrl);
    if (playable.length < minTracks) {
      toast(`Потрібно щонайменше ${minTracks} треки з прев'ю — вибери інший альбом`);
      return null;
    }
    return { ...album, tracks: playable };
  }

  // ---------- Батл треків ----------
  const battle = { album: null, round: [], next: [], idx: 0, roundNo: 1, done: 0, total: 0, out: [] };

  async function startBattle(albumId) {
    const album = await loadAlbumForMode(albumId, 2);
    if (!album) return;
    Object.assign(battle, {
      album, round: shuffle(album.tracks), next: [], idx: 0, roundNo: 1, done: 0,
      total: album.tracks.length - 1, out: []
    });
    $('battle-album-title').textContent = `${album.title}`;
    showView('view-battle');
    renderMatch();
  }

  function roundName() {
    const left = battle.round.length;
    if (left === 2) return 'Фінал';
    if (left <= 4) return 'Півфінал';
    if (left <= 8) return 'Чвертьфінал';
    return `Раунд ${battle.roundNo}`;
  }

  function renderMatch() {
    // Непарний трек проходить далі без бою
    if (battle.idx === battle.round.length - 1) {
      battle.next.push(battle.round[battle.idx]);
      battle.idx++;
    }
    if (battle.idx >= battle.round.length) {
      battle.round = battle.next;
      battle.next = [];
      battle.idx = 0;
      battle.roundNo++;
      if (battle.round.length === 1) { renderBattleWinner(); return; }
      return renderMatch();
    }
    const a = battle.round[battle.idx], b = battle.round[battle.idx + 1];
    $('battle-round-label').textContent = roundName();
    $('battle-hint').textContent = 'Послухай обидва треки і вибери кращий';
    $('battle-progress').style.width = `${(battle.done / Math.max(1, battle.total)) * 100}%`;
    const arena = $('battle-arena');
    arena.innerHTML = '';
    [a, b].forEach((t, side) => {
      const card = document.createElement('div');
      card.className = 'battle-card frosted ' + (side ? 'is-right' : 'is-left');
      card.innerHTML = `
        <div class="battle-cover">
          <img src="${esc(battle.album.artwork)}" alt="" onerror="this.src='icons/album-placeholder.svg'">
          <button class="playback-btn battle-play" aria-label="Слухати"><img src="icons/play.svg" alt="" class="svg-icon"></button>
        </div>
        <div class="battle-title">${document.body.classList.contains('sr-blind-on') ? (side ? 'Трек B' : 'Трек A') : esc(t.title)}</div>
        <button class="btn btn-primary battle-pick">Цей краще</button>`;
      card.querySelector('.battle-play').addEventListener('click', (e) => {
        e.stopPropagation();
        if (card.classList.contains('is-audio-playing')) stopModeAudio();
        else playPreview(t.previewUrl, card, 0, 0);
      });
      card.querySelector('.battle-pick').addEventListener('click', () => pickWinner(side));
      arena.appendChild(card);
      if (side === 0) {
        const vs = document.createElement('div');
        vs.className = 'battle-vs';
        vs.textContent = 'VS';
        arena.appendChild(vs);
      }
    });
  }

  function pickWinner(side) {
    stopModeAudio();
    vibrate(15);
    const a = battle.round[battle.idx], b = battle.round[battle.idx + 1];
    const win = side ? b : a, lose = side ? a : b;
    battle.next.push(win);
    battle.out.push({ track: lose, round: battle.roundNo });
    battle.done++;
    const cards = $('battle-arena').querySelectorAll('.battle-card');
    cards[side].classList.add('is-winner');
    cards[side ? 0 : 1].classList.add('is-loser');
    battle.idx += 2;
    setTimeout(renderMatch, 650);
  }

  function renderBattleWinner() {
    const winner = battle.round[0];
    $('battle-round-label').textContent = 'Результат';
    $('battle-hint').textContent = 'Ось як ти розставив треки';
    $('battle-progress').style.width = '100%';
    // Рейтинг: переможець, потім за тим, в якому раунді вилетіли (пізніше — вище)
    const ranking = [winner, ...battle.out.slice().sort((x, y) => y.round - x.round).map((o) => o.track)];
    const arena = $('battle-arena');
    arena.innerHTML = `
      <div class="battle-result">
        <div class="battle-trophy">🏆</div>
        <div class="battle-cover big"><img src="${esc(battle.album.artwork)}" alt=""></div>
        <div class="battle-winner-label">Твій найкращий трек</div>
        <div class="battle-winner-title">${esc(winner.title)}</div>
        <ol class="battle-ranking">${ranking.map((t, i) => `<li><span>${i + 1}</span>${esc(t.title)}</li>`).join('')}</ol>
        <div class="battle-actions">
          <button class="btn btn-inactive" data-act="again">⚔️ Ще раз</button>
          <button class="btn btn-inactive" data-act="other">Інший альбом</button>
          <button class="btn btn-primary" data-act="rate">Оцінити альбом</button>
        </div>
      </div>`;
    playPreview(winner.previewUrl, null, 0, 0);
    vibrate([30, 50, 30, 50, 60]);
    arena.querySelector('[data-act="again"]').onclick = () => startBattle(battle.album.id);
    arena.querySelector('[data-act="other"]').onclick = () => openPicker('⚔️ Батл треків: вибери альбом', startBattle);
    arena.querySelector('[data-act="rate"]').onclick = () => startAlbumRating(battle.album.id);
  }

  // ---------- Вгадай трек ----------
  const quiz = { album: null, order: [], q: 0, total: 10, score: 0, correct: 0, streak: 0, startedAt: 0, answered: false, extra: 0 };

  async function startQuiz(albumId) {
    const album = await loadAlbumForMode(albumId, 4);
    if (!album) return;
    const total = Math.min(10, album.tracks.length);
    Object.assign(quiz, { album, order: shuffle(album.tracks).slice(0, total), q: 0, total, score: 0, correct: 0, streak: 0 });
    showView('view-quiz');
    renderQuestion();
  }

  function playQuizSnippet(len) {
    const t = quiz.order[quiz.q];
    const start = 3 + Math.random() * 18;
    playPreview(t.previewUrl, $('quiz-disc'), start, len);
  }

  function renderQuestion() {
    const t = quiz.order[quiz.q];
    quiz.answered = false;
    quiz.extra = 0;
    $('quiz-round-label').textContent = `Питання ${quiz.q + 1} з ${quiz.total}`;
    const others = shuffle(quiz.album.tracks.filter((x) => x.id !== t.id)).slice(0, 3);
    const options = shuffle([t, ...others]);
    const stage = $('quiz-stage');
    stage.innerHTML = `
      <div class="quiz-head">
        <span class="badge-tag">🎧 Вгадай трек</span>
        <div class="quiz-score"><b id="quiz-score">${quiz.score}</b> очок${quiz.streak > 1 ? ` · 🔥 ${quiz.streak}` : ''}</div>
      </div>
      <div class="quiz-disc-wrap">
        <button class="quiz-disc" id="quiz-disc" aria-label="Слухати уривок">
          <img src="${esc(quiz.album.artwork)}" alt="" onerror="this.src='icons/album-placeholder.svg'">
          <span class="quiz-disc-hole"></span>
        </button>
      </div>
      <p class="view-subtitle quiz-album">${esc(quiz.album.title)} — ${esc(quiz.album.artist)}</p>
      <div class="quiz-options">${options.map((o) => `<button class="btn btn-inactive quiz-opt" data-id="${esc(o.id)}">${esc(o.title)}</button>`).join('')}</div>
      <div class="quiz-footer">
        <button class="btn btn-inactive" id="quiz-more">▶ Ще 5 секунд (−25)</button>
      </div>`;
    $('quiz-disc').addEventListener('click', () => playQuizSnippet(5));
    $('quiz-more').addEventListener('click', () => {
      if (quiz.answered) return;
      quiz.extra++;
      playQuizSnippet(5 + quiz.extra * 5);
    });
    stage.querySelectorAll('.quiz-opt').forEach((btn) => btn.addEventListener('click', () => answer(btn, String(t.id))));
    quiz.startedAt = performance.now();
    playQuizSnippet(5);
  }

  function answer(btn, rightId) {
    if (quiz.answered) return;
    quiz.answered = true;
    stopModeAudio();
    const ok = btn.dataset.id === rightId;
    const secs = (performance.now() - quiz.startedAt) / 1000;
    $('quiz-stage').querySelectorAll('.quiz-opt').forEach((b) => {
      b.disabled = true;
      if (b.dataset.id === rightId) b.classList.add('is-right');
    });
    if (ok) {
      quiz.streak++;
      quiz.correct++;
      const pts = Math.max(20, 100 + Math.max(0, 50 - Math.round(secs * 5)) - quiz.extra * 25 + (quiz.streak > 1 ? 10 * (quiz.streak - 1) : 0));
      quiz.score += pts;
      btn.classList.add('is-right');
      vibrate(20);
      toast(`+${pts} ${quiz.streak > 2 ? '🔥' : '✅'}`);
    } else {
      quiz.streak = 0;
      btn.classList.add('is-wrong');
      vibrate([40, 40, 40]);
    }
    $('quiz-score').textContent = quiz.score;
    const footer = $('quiz-stage').querySelector('.quiz-footer');
    footer.innerHTML = `<button class="btn btn-primary" id="quiz-next">${quiz.q + 1 < quiz.total ? 'Далі →' : 'Результат'}</button>`;
    $('quiz-next').addEventListener('click', () => {
      quiz.q++;
      if (quiz.q < quiz.total) renderQuestion(); else renderQuizResult();
    });
    // Правильний трек грає ще раз — щоб запам'ятати
    const t = quiz.order[quiz.q];
    playPreview(t.previewUrl, null, 0, 6);
  }

  function renderQuizResult() {
    const key = 'songrate_quiz_best';
    const best = LS.get(key, {});
    const prev = best[quiz.album.id] || 0;
    const isRecord = quiz.score > prev;
    if (isRecord) { best[quiz.album.id] = quiz.score; LS.set(key, best); }
    const ratio = quiz.correct / quiz.total;
    const verdict = ratio === 1 ? 'Ти знаєш цей альбом напам\'ять 🤯' : ratio >= 0.7 ? 'Справжній фанат 🔥' : ratio >= 0.4 ? 'Непогано, але є куди рости 🎧' : 'Схоже, альбом варто переслухати 😅';
    $('quiz-round-label').textContent = 'Результат';
    $('quiz-stage').innerHTML = `
      <div class="battle-result">
        <div class="battle-trophy">${ratio >= 0.7 ? '🏆' : '🎧'}</div>
        <div class="quiz-final-score">${quiz.score}</div>
        <div class="battle-winner-label">${quiz.correct} з ${quiz.total} правильно${isRecord ? ' · новий рекорд!' : prev ? ` · рекорд ${prev}` : ''}</div>
        <div class="battle-winner-title">${verdict}</div>
        <div class="battle-actions">
          <button class="btn btn-inactive" data-act="again">🔁 Ще раз</button>
          <button class="btn btn-inactive" data-act="other">Інший альбом</button>
          <button class="btn btn-primary" data-act="rate">Оцінити альбом</button>
        </div>
      </div>`;
    vibrate(isRecord ? [30, 50, 30, 50, 80] : 20);
    const s = $('quiz-stage');
    s.querySelector('[data-act="again"]').onclick = () => startQuiz(quiz.album.id);
    s.querySelector('[data-act="other"]').onclick = () => openPicker('🎧 Вгадай трек: вибери альбом', startQuiz);
    s.querySelector('[data-act="rate"]').onclick = () => startAlbumRating(quiz.album.id);
  }

  // =====================================================================
  window.SR = {
    fillAvatar,
    onAuthChange,
    onUsernameChange: () => { renderMyAvatar(); pushProfile(); },
    onProfileRender: renderMyAvatar,
    renderModes,
    myAvatar,
    playPreview,
    stopModeAudio,
    isBlind: () => !!LS.get(BLIND_KEY, false),
    setBlind: (on) => { LS.set(BLIND_KEY, !!on); renderModes(); document.body.classList.toggle('sr-blind-on', !!on); }
  };

  function init() {
    initAvatarUI();
    initPicker();
    renderModes();
    renderMyAvatar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
