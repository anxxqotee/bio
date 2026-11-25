// SongRate — розумні рекомендації, сліпе оцінювання по всьому сайту,
// персональна вікторина "Вгадай трек", привітальний блок і нижня навігація на телефоні
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHTML(v);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const norm = (s) => String(s || '').trim().toLowerCase();
  const big = (u, size = 600) => (u ? u.replace('100x100bb', `${size}x${size}bb`) : 'icons/album-placeholder.svg');

  // =====================================================================
  // 1. ПРОФІЛЬ СМАКУ
  // Кожна оцінка дає вагу артисту і жанру: вище 5.5 — "подобається", нижче — "не подобається".
  // Свіжі оцінки важать більше (згасання ~3 місяці).
  // =====================================================================
  function tasteProfile() {
    const artists = new Map(); // norm -> {name, w, n}
    const genres = new Map();  // genre -> w
    const now = Date.now();
    State.ratingsHistory.forEach((h) => {
      const s = Number(h.avgScore) || 0;
      if (s <= 0) return; // скіп — не сигнал
      const ts = typeof getReviewTimestamp === 'function' ? getReviewTimestamp(h) : 0;
      const ageDays = ts ? (now - ts) / 864e5 : 60;
      const recency = 0.5 + Math.exp(-ageDays / 90);
      const w = ((s - 5.5) / 4.5) * recency;
      const key = norm(h.artist);
      if (key) {
        const a = artists.get(key) || { name: h.artist, w: 0, n: 0 };
        a.w += w; a.n++;
        artists.set(key, a);
      }
      if (h.genre) genres.set(h.genre, (genres.get(h.genre) || 0) + w);
    });
    const liked = [...artists.values()].filter((a) => a.w > 0.25).sort((a, b) => b.w - a.w);
    const disliked = new Set([...artists.entries()].filter(([, a]) => a.w < -0.6).map(([k]) => k));
    const topGenres = [...genres.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([g]) => g);
    return { liked, disliked, topGenres, hasData: artists.size > 0 };
  }

  // Артисти, схожі на вподобаних: сусіди з тієї ж жанрової групи
  function neighboursOf(artistName) {
    const key = norm(artistName);
    for (const [genre, list] of Object.entries(GENRE_ARTIST_MAP)) {
      if (list.some((a) => norm(a) === key)) return { genre, list: list.filter((a) => norm(a) !== key) };
    }
    return null;
  }

  function genreGroup(genre) {
    const g = norm(genre);
    const k = Object.keys(GENRE_ARTIST_MAP).find((x) => norm(x) === g || g.includes(norm(x)) || norm(x).includes(g));
    return k ? { genre: k, list: GENRE_ARTIST_MAP[k] } : null;
  }

  // =====================================================================
  // 2. РЕКОМЕНДАЦІЇ
  // =====================================================================
  let recSeq = 0;

  async function smartRecommendations() {
    const seq = ++recSeq;
    const grid = $('recommendations-grid');
    const subtitle = $('home-subtitle');
    grid.innerHTML = Array.from({ length: 8 }, () => '<div class="music-card frosted skeleton-card"><div class="sk-thumb"></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('');

    const taste = tasteProfile();
    const rated = new Set(State.ratingsHistory.map((h) => String(h.albumId)));
    const queries = []; // {term, reason, weight, onlyArtist}
    const used = new Set();
    const addQ = (term, reason, weight, onlyArtist = null) => {
      const k = norm(term);
      if (!k || used.has(k) || taste.disliked.has(k)) return;
      used.add(k);
      queries.push({ term, reason, weight, onlyArtist });
    };

    if (taste.hasData) {
      subtitle.textContent = 'Зібрано під твій смак — і трохи нового';
      // Ще від улюблених артистів
      taste.liked.slice(0, 3).forEach((a) => addQ(a.name, `Ще від ${a.name}`, 3 + a.w, a.name));
      // Схожі артисти
      taste.liked.slice(0, 4).forEach((a) => {
        const nb = neighboursOf(a.name);
        if (nb) shuffle(nb.list).slice(0, 2).forEach((x) => addQ(x, `Схоже на ${a.name}`, 2.4));
      });
      // Улюблені жанри
      taste.topGenres.slice(0, 3).forEach((g) => {
        const grp = genreGroup(g);
        if (grp) shuffle(grp.list).slice(0, 2).forEach((x) => addQ(x, `Бо ти любиш ${grp.genre}`, 2));
        else addQ(g, `Бо ти любиш ${g}`, 1.6);
      });
    } else {
      subtitle.textContent = 'Оціни кілька релізів — і рекомендації підлаштуються під тебе';
    }
    // Трохи нового для різноманіття
    const allArtists = shuffle(Object.values(GENRE_ARTIST_MAP).flat());
    for (const a of allArtists) {
      if (queries.length >= 12) break;
      addQ(a, taste.hasData ? 'Щось нове' : 'Популярне', taste.hasData ? 0.8 : 1);
    }

    const results = await Promise.all(queries.slice(0, 12).map((q) => MusicAPI.searchAlbums(q.term, 10).then((r) => ({ q, r }))));
    if (seq !== recSeq) return;

    const candidates = [];
    const seenAlbum = new Set();
    results.forEach(({ q, r }) => {
      r.forEach((it, idx) => {
        const id = String(it.collectionId || '');
        if (!id || seenAlbum.has(id) || rated.has(id) || !it.collectionName) return;
        if (taste.disliked.has(norm(it.artistName))) return;
        if (q.onlyArtist && norm(it.artistName) !== norm(q.onlyArtist)) return;
        if ((it.trackCount || 0) < 3) return; // синглам тут не місце
        seenAlbum.add(id);
        // Вище в пошуку iTunes — популярніший реліз
        const score = q.weight + (1 - idx / 10) * 0.8 + Math.random() * 0.6;
        candidates.push({
          id: it.collectionId, title: it.collectionName, artist: it.artistName,
          artwork: big(it.artworkUrl100), reason: q.reason, score
        });
      });
    });

    // Не більше 2 альбомів одного артиста
    candidates.sort((a, b) => b.score - a.score);
    // і не більше 4 карток з однією причиною — щоб було різноманіття
    const perArtist = new Map();
    const perReason = new Map();
    const picked = [];
    for (const c of candidates) {
      const k = norm(c.artist);
      if ((perArtist.get(k) || 0) >= (picked.length < 8 ? 1 : 2)) continue;
      if ((perReason.get(c.reason) || 0) >= 4) continue;
      perArtist.set(k, (perArtist.get(k) || 0) + 1);
      perReason.set(c.reason, (perReason.get(c.reason) || 0) + 1);
      picked.push(c);
      if (picked.length >= 12) break;
    }

    grid.innerHTML = '';
    if (!picked.length) {
      grid.innerHTML = '<p style="color: var(--color-text-muted); grid-column: 1 / -1;">Не вдалося отримати релізи. Спробуй ще раз.</p>';
      return;
    }
    picked.forEach((album, i) => {
      const card = document.createElement('div');
      card.className = 'music-card frosted';
      card.style.animationDelay = `${i * 40}ms`;
      card.innerHTML = `
        <div class="card-thumb-wrap">
          <img src="${esc(album.artwork)}" alt="${esc(album.title)}" class="card-thumb" loading="lazy" onerror="this.onerror=null; this.src='icons/album-placeholder.svg'">
          <span class="rec-reason">${esc(album.reason)}</span>
        </div>
        <div class="card-title">${esc(album.title)}</div>
        <div class="card-artist">${esc(album.artist)}</div>
        <button class="btn btn-inactive btn-rate-album">Оцінити альбом</button>`;
      card.querySelector('.card-thumb').onclick = () => openAlbumPage(album.id);
      card.querySelector('.card-title').onclick = () => openAlbumPage(album.id);
      card.querySelector('.card-artist').onclick = () => openFullSearch(album.artist);
      card.querySelector('.btn-rate-album').addEventListener('click', (e) => { e.stopPropagation(); startAlbumRating(album.id); });
      grid.appendChild(card);
    });
  }

  // Підміняємо стару функцію (її викликають кнопка "оновити" і перший показ головної)
  window.loadHomeRecommendations = smartRecommendations;

  // =====================================================================
  // 3. СЛІПЕ ОЦІНЮВАННЯ ПО ВСЬОМУ САЙТУ
  // =====================================================================
  const isBlind = () => !!(window.SR && SR.isBlind && SR.isBlind());

  function initBlindToggle() {
    const actions = document.querySelector('.header-actions');
    if (!actions || $('btn-blind-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-blind-toggle';
    btn.className = 'icon-btn blind-btn';
    btn.type = 'button';
    btn.title = 'Сліпе оцінювання';
    btn.setAttribute('aria-label', 'Сліпе оцінювання');
    btn.innerHTML = '<span class="blind-eye" aria-hidden="true"></span>';
    actions.insertBefore(btn, actions.firstChild);
    const sync = () => {
      const on = isBlind();
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      document.body.classList.toggle('sr-blind-on', on);
    };
    btn.addEventListener('click', () => {
      SR.setBlind(!isBlind());
      sync();
      vibrate(10);
      showToast(isBlind() ? '🙈 Сліпе оцінювання: обкладинки й назви сховані до кінця оцінки' : '👀 Сліпе оцінювання вимкнено');
      if (isViewVisible('view-rating')) document.body.classList.toggle('sr-blind-active', isBlind());
    });
    sync();
  }

  // Підсумок після сліпої оцінки: спершу все сховано, потім ефектне відкриття
  function maybeBlindReveal(viewId, fromView) {
    const view = $('view-summary');
    if (!view) return;
    view.classList.remove('sr-reveal-pending', 'sr-revealed');
    // Ховаємо лише щойно завершену сліпу оцінку (прийшли прямо з екрана оцінювання)
    if (viewId !== 'view-summary' || !isBlind() || fromView !== 'view-rating') return;
    view.classList.add('sr-reveal-pending');
    let btn = $('btn-blind-reveal');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'btn-blind-reveal';
      btn.className = 'btn btn-primary blind-reveal-btn';
      btn.innerHTML = '🙈 Хто ж це був? <b>Відкрити</b>';
      view.querySelector('.summary-hero-bar').appendChild(btn);
      btn.addEventListener('click', () => {
        view.classList.remove('sr-reveal-pending');
        view.classList.add('sr-revealed');
        vibrate([20, 40, 30]);
      });
    }
  }

  // =====================================================================
  // 4. ВГАДАЙ ТРЕК — по оцінених треках і схожих
  // =====================================================================
  async function searchSongs(term, limit = 12) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}`);
      if (!r.ok) return [];
      const j = await r.json();
      return (j.results || []).filter((t) => t.previewUrl && t.trackName);
    } catch (e) { return []; }
  }

  async function buildQuizPool() {
    const pool = [];
    const seen = new Set();
    const add = (t, from) => {
      const key = norm(t.title) + '|' + norm(t.artist);
      if (!t.previewUrl || seen.has(key)) return;
      seen.add(key);
      pool.push({ ...t, from });
    };
    const hist = State.ratingsHistory.filter((h) => Number(h.avgScore) > 0);

    // Оцінені альбоми (до 5 останніх)
    const albumIds = [...new Set(hist.filter((h) => !h.isSingleTrack).map((h) => h.albumId))].slice(0, 5);
    const albums = await Promise.all(albumIds.map((id) => MusicAPI.getAlbumWithTracks(id)));
    albums.forEach((a) => a && a.tracks.forEach((t) => add({ id: t.id, title: t.title, artist: a.artist, artwork: a.artwork, previewUrl: t.previewUrl }, 'rated')));
    // Оцінені окремі треки
    const singles = hist.filter((h) => h.isSingleTrack).slice(0, 6);
    const singleInfo = await Promise.all(singles.map((h) => MusicAPI.getTrack(h.albumId)));
    singleInfo.forEach((t) => t && add({ id: t.trackId, title: t.trackName, artist: t.artistName, artwork: big(t.artworkUrl100), previewUrl: t.previewUrl }, 'rated'));

    // Схожі: вподобані артисти та їхні "сусіди" по жанру
    const taste = tasteProfile();
    const similarArtists = [];
    taste.liked.slice(0, 3).forEach((a) => {
      similarArtists.push(a.name);
      const nb = neighboursOf(a.name);
      if (nb) similarArtists.push(...shuffle(nb.list).slice(0, 2));
    });
    if (similarArtists.length < 3) similarArtists.push(...shuffle(Object.values(GENRE_ARTIST_MAP).flat()).slice(0, 4));
    const songs = await Promise.all([...new Set(similarArtists)].slice(0, 6).map((a) => searchSongs(a, 10)));
    songs.flat().forEach((t) => add({ id: t.trackId, title: t.trackName, artist: t.artistName, artwork: big(t.artworkUrl100), previewUrl: t.previewUrl }, 'similar'));
    return { pool, hasRated: pool.some((t) => t.from === 'rated') };
  }

  const quiz = { pool: [], order: [], q: 0, total: 10, score: 0, correct: 0, streak: 0, startedAt: 0, answered: false, extra: 0 };

  async function startPersonalQuiz() {
    showToast('Збираємо треки для вікторини...');
    const { pool, hasRated } = await buildQuizPool();
    if (pool.length < 4) { showToast('Замало треків з прев\'ю. Оціни ще кілька релізів!'); return; }
    if (!hasRated) showToast('Оціни кілька релізів — і вікторина буде по твоїй музиці');
    // Приблизно 60% питань — з оцінених, решта — схожі
    const rated = shuffle(pool.filter((t) => t.from === 'rated'));
    const similar = shuffle(pool.filter((t) => t.from !== 'rated'));
    const total = Math.min(10, pool.length);
    const nRated = Math.min(rated.length, Math.ceil(total * 0.6));
    const order = shuffle([...rated.slice(0, nRated), ...similar.slice(0, total - nRated), ...rated.slice(nRated)]).slice(0, total);
    Object.assign(quiz, { pool, order, q: 0, total: order.length, score: 0, correct: 0, streak: 0 });
    showView('view-quiz');
    renderQuestion();
  }

  function snippet(len) {
    const t = quiz.order[quiz.q];
    SR.playPreview(t.previewUrl, $('quiz-disc'), 3 + Math.random() * 18, len);
  }

  function renderQuestion() {
    const t = quiz.order[quiz.q];
    quiz.answered = false;
    quiz.extra = 0;
    $('quiz-round-label').textContent = `Питання ${quiz.q + 1} з ${quiz.total}`;
    // Відволікаючі варіанти: спершу той самий артист, потім будь-які
    const others = quiz.pool.filter((x) => x !== t);
    const same = shuffle(others.filter((x) => norm(x.artist) === norm(t.artist)));
    const rest = shuffle(others.filter((x) => norm(x.artist) !== norm(t.artist)));
    const options = shuffle([t, ...[...same, ...rest].slice(0, 3)]);
    const label = (o) => `<span class="opt-title">${esc(o.title)}</span><span class="opt-artist">${esc(o.artist)}</span>`;
    $('quiz-stage').innerHTML = `
      <div class="quiz-head">
        <span class="badge-tag">${t.from === 'rated' ? '⭐ З твоїх оцінок' : '✨ Схоже на твій смак'}</span>
        <div class="quiz-score"><b id="quiz-score">${quiz.score}</b> очок${quiz.streak > 1 ? ` · 🔥 ${quiz.streak}` : ''}</div>
      </div>
      <div class="quiz-disc-wrap">
        <button class="quiz-disc" id="quiz-disc" aria-label="Слухати уривок">
          <img src="${esc(t.artwork)}" alt="" onerror="this.src='icons/album-placeholder.svg'">
          <span class="quiz-disc-hole"></span>
        </button>
      </div>
      <p class="view-subtitle quiz-album">Що це за трек? Тапни платівку, щоб послухати ще раз</p>
      <div class="quiz-options">${options.map((o) => `<button class="btn btn-inactive quiz-opt" data-k="${quiz.pool.indexOf(o)}">${label(o)}</button>`).join('')}</div>
      <div class="quiz-footer"><button class="btn btn-inactive" id="quiz-more">▶ Ще 5 секунд (−25)</button></div>`;
    $('quiz-disc').addEventListener('click', () => snippet(5 + quiz.extra * 5));
    $('quiz-more').addEventListener('click', () => { if (!quiz.answered) { quiz.extra++; snippet(5 + quiz.extra * 5); } });
    const right = String(quiz.pool.indexOf(t));
    $('quiz-stage').querySelectorAll('.quiz-opt').forEach((b) => b.addEventListener('click', () => answer(b, right)));
    quiz.startedAt = performance.now();
    snippet(5);
  }

  function answer(btn, right) {
    if (quiz.answered) return;
    quiz.answered = true;
    SR.stopModeAudio();
    const ok = btn.dataset.k === right;
    const secs = (performance.now() - quiz.startedAt) / 1000;
    $('quiz-stage').querySelectorAll('.quiz-opt').forEach((b) => { b.disabled = true; if (b.dataset.k === right) b.classList.add('is-right'); });
    if (ok) {
      quiz.streak++; quiz.correct++;
      const pts = Math.max(20, 100 + Math.max(0, 50 - Math.round(secs * 5)) - quiz.extra * 25 + (quiz.streak > 1 ? 10 * (quiz.streak - 1) : 0));
      quiz.score += pts;
      btn.classList.add('is-right');
      vibrate(20);
      showToast(`+${pts} ${quiz.streak > 2 ? '🔥' : '✅'}`);
    } else {
      quiz.streak = 0;
      btn.classList.add('is-wrong');
      vibrate([40, 40, 40]);
    }
    $('quiz-score').textContent = quiz.score;
    const t = quiz.order[quiz.q];
    const disc = $('quiz-disc');
    if (disc) disc.classList.add('is-revealed');
    $('quiz-stage').querySelector('.quiz-footer').innerHTML = `
      <button class="btn btn-inactive" id="quiz-rate">Оцінити цей трек</button>
      <button class="btn btn-primary" id="quiz-next">${quiz.q + 1 < quiz.total ? 'Далі →' : 'Результат'}</button>`;
    $('quiz-next').addEventListener('click', () => { quiz.q++; if (quiz.q < quiz.total) renderQuestion(); else renderResult(); });
    $('quiz-rate').addEventListener('click', () => startSingleTrackRating({
      id: t.id, title: t.title, artist: t.artist, albumTitle: t.title, genre: 'Музика', artwork: t.artwork, previewUrl: t.previewUrl
    }));
    SR.playPreview(t.previewUrl, null, 0, 6);
  }

  function renderResult() {
    const best = Number(localStorage.getItem('songrate_quiz_personal_best') || 0);
    const isRecord = quiz.score > best;
    if (isRecord) try { localStorage.setItem('songrate_quiz_personal_best', String(quiz.score)); } catch (e) {}
    const ratio = quiz.correct / quiz.total;
    const verdict = ratio === 1 ? 'Ти знаєш свою музику напам\'ять 🤯' : ratio >= 0.7 ? 'Справжній меломан 🔥' : ratio >= 0.4 ? 'Непогано, але є куди рости 🎧' : 'Схоже, час переслухати улюблене 😅';
    $('quiz-round-label').textContent = 'Результат';
    $('quiz-stage').innerHTML = `
      <div class="battle-result">
        <div class="battle-trophy">${ratio >= 0.7 ? '🏆' : '🎧'}</div>
        <div class="quiz-final-score">${quiz.score}</div>
        <div class="battle-winner-label">${quiz.correct} з ${quiz.total} правильно${isRecord ? ' · новий рекорд!' : best ? ` · рекорд ${best}` : ''}</div>
        <div class="battle-winner-title">${verdict}</div>
        <div class="battle-actions">
          <button class="btn btn-inactive" id="quiz-home">На головну</button>
          <button class="btn btn-primary" id="quiz-again">🔁 Ще раз</button>
        </div>
      </div>`;
    vibrate(isRecord ? [30, 50, 30, 50, 80] : 20);
    $('quiz-again').onclick = startPersonalQuiz;
    $('quiz-home').onclick = () => showView('view-home');
  }

  // =====================================================================
  // 5. ГОЛОВНА: привітання + статистика; НИЖНЯ НАВІГАЦІЯ НА ТЕЛЕФОНІ
  // =====================================================================
  function renderHero() {
    let hero = $('home-hero');
    const col = document.querySelector('#view-home .home-main-col');
    if (!col) return;
    if (!hero) {
      hero = document.createElement('div');
      hero.id = 'home-hero';
      hero.className = 'home-hero frosted';
      col.insertBefore(hero, col.firstChild);
    }
    const h = State.ratingsHistory;
    const avg = h.length ? h.reduce((a, x) => a + (Number(x.avgScore) || 0), 0) / h.length : 0;
    const taste = tasteProfile();
    const fav = taste.liked[0] ? taste.liked[0].name : null;
    const hour = new Date().getHours();
    const hi = hour < 5 ? 'Доброї ночі' : hour < 12 ? 'Доброго ранку' : hour < 18 ? 'Привіт' : 'Доброго вечора';
    hero.innerHTML = `
      <img class="hero-avatar" src="${esc(SR.myAvatar())}" alt="">
      <div class="hero-text">
        <div class="hero-hi">${hi}, <b>@${esc(State.username)}</b></div>
        <div class="hero-sub">${h.length ? (fav ? `Твій фаворит зараз — ${esc(fav)}` : 'Продовжуй оцінювати — рекомендації вчаться') : 'Почни з будь-якого альбому нижче або спробуй режими 👇'}</div>
      </div>
      <div class="hero-stats">
        <div><b>${h.length}</b><span>${typeof pluralizeRatings === 'function' ? pluralizeRatings(h.length) : 'оцінок'}</span></div>
        <div><b style="color:${h.length ? getScoreColor(avg) : 'inherit'}">${h.length ? avg.toFixed(1) : '—'}</b><span>середній бал</span></div>
      </div>`;
    hero.querySelector('.hero-avatar').onclick = () => { updateProfileView(); showView('view-profile'); };
  }

  function initBottomNav() {
    if ($('bottom-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'bottom-nav';
    nav.className = 'bottom-nav frosted';
    nav.innerHTML = `
      <button data-nav="home" class="is-active"><span class="bn-ico">🏠</span><span>Головна</span></button>
      <button data-nav="modes"><span class="bn-ico">🎮</span><span>Режими</span></button>
      <button data-nav="search"><span class="bn-ico">🔍</span><span>Пошук</span></button>
      <button data-nav="profile"><span class="bn-ico">👤</span><span>Профіль</span></button>`;
    document.body.appendChild(nav);
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      vibrate(8);
      const where = b.dataset.nav;
      if (where === 'home') { stopTrackAudio(); showView('view-home'); }
      else if (where === 'modes') {
        stopTrackAudio(); showView('view-home');
        setTimeout(() => document.querySelector('.modes-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      } else if (where === 'search') { window.scrollTo({ top: 0, behavior: 'smooth' }); $('search-input').focus(); }
      else if (where === 'profile') { stopTrackAudio(); updateProfileView(); showView('view-profile'); }
    });
  }

  function syncNav(viewId) {
    const nav = $('bottom-nav');
    if (!nav) return;
    const map = { 'view-home': 'home', 'view-profile': 'profile', 'view-search': 'search', 'view-battle': 'modes', 'view-quiz': 'modes' };
    nav.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === map[viewId]));
    // Під час оцінювання і в іграх нижня панель не заважає
    nav.classList.toggle('is-hidden', ['view-rating', 'view-battle', 'view-quiz'].includes(viewId));
  }

  // Обгортка навігації: після кожного переходу оновлюємо привітання, панель і сліпий режим
  const origShow = window.showView;
  window.showView = function (viewId, pushHistory) {
    const fromView = document.querySelector('.view:not(.hidden)')?.id;
    const r = origShow.call(this, viewId, pushHistory);
    syncNav(viewId);
    maybeBlindReveal(viewId, fromView);
    if (viewId === 'view-home') renderHero();
    return r;
  };

  window.SRSmart = { startPersonalQuiz, tasteProfile };

  function init() {
    initBlindToggle();
    initBottomNav();
    renderHero();
    syncNav(document.querySelector('.view:not(.hidden)')?.id || 'view-home');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
