const SUPABASE_URL = 'https://uldidiwmyhojyjatpwud.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_92VCW9pqVze2MfwF3tRHIA_Bu5tYUto';

const supabaseClient = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const DEFAULT_BRAND_COLORS = {
  purple: '#8b5cf6',
  purpleLight: '#a78bfa',
  glow1: '#581c87',
  glow2: '#831843',
  glow3: '#1e1b4b'
};

const GENRE_ARTIST_MAP = {
  'Hip-Hop': ['Metro Boomin', 'Kendrick Lamar', 'Travis Scott', 'Playboi Carti', 'J. Cole', 'Future', 'A$AP Rocky', '21 Savage', 'Don Toliver', 'Lil Uzi Vert'],
  'Alternative': ['Tame Impala', 'Gorillaz', 'Radiohead', 'The Neighbourhood', 'Arctic Monkeys', 'Deftones', 'Slowdive', 'Beach House', 'Mac DeMarco'],
  'R&B/Soul': ['The Weeknd', 'Frank Ocean', 'Brent Faiyaz', 'Steve Lacy', 'SZA', 'Daniel Caesar', 'Joji', 'Childish Gambino', 'Giveon'],
  'Electronic': ['Daft Punk', 'Justice', 'Kavinsky', 'Kaytranada', 'Disclosure', 'Flume', 'Aphex Twin', 'Fred again..'],
  'Rock': ['Smashing Pumpkins', 'Nirvana', 'Linkin Park', 'The Strokes', 'Foo Fighters', 'Red Hot Chili Peppers']
};

const State = {
  user: null,
  username: localStorage.getItem('songrate_username') || 'Користувач',
  ratingsHistory: JSON.parse(localStorage.getItem('songrate_history')) || [],
  currentAlbum: null,
  isSingleTrackMode: false,
  currentTrackIndex: 0,
  currentTrackRatings: {},
  currentScoreValue: 0.0,
  isUnrated: true,
  audio: new Audio(),
  isPlaying: false,
  isEnded: false,
  animFrameId: null,
  authMode: 'login',
  lastSearchResults: [],
  previousView: 'view-home',
  volume: 0.8,
  activeReviewId: null
};

State.audio.preload = 'auto';
State.audio.volume = State.volume;

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initSearch();
  initMagneticLiquidSlider();
  initVolumeControls();
  initRatingNavButtons();
  initAudioEvents();
  initAuth();
  initRecommendationsRefresh();
  initProfileSettings();
  initSharingButtons();
  checkInitialSession();
  handleUrlRouting(); // Перевіряємо посилання ?album=, ?review= або ?user=
});

function getScoreColor(val) {
  if (val === 0.0) return '#64748b'; // Сірий колір для скіпу
  if (val >= 9.9) return '#fbbf24'; // Сяюче золото для 10
  if (val >= 9.0) return '#a855f7'; // Фіолетовий
  if (val >= 7.0) return '#10b981'; // Смарагдовий
  if (val >= 4.0) return '#eab308'; // Чистий жовтий
  if (val >= 2.5) return '#f97316'; // Помаранчевий
  return '#ef4444';                // Червоний
}

function applyDynamicSiteTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty('--color-purple', theme.purple);
  root.style.setProperty('--color-purple-light', theme.purpleLight);
  root.style.setProperty('--accent-1', theme.glow1);
  root.style.setProperty('--accent-2', theme.glow2);
  root.style.setProperty('--accent-3', theme.glow3);
}

function resetSiteTheme() {
  const root = document.documentElement;
  root.style.setProperty('--color-purple', DEFAULT_BRAND_COLORS.purple);
  root.style.setProperty('--color-purple-light', DEFAULT_BRAND_COLORS.purpleLight);
  root.style.setProperty('--accent-1', DEFAULT_BRAND_COLORS.glow1);
  root.style.setProperty('--accent-2', DEFAULT_BRAND_COLORS.glow2);
  root.style.setProperty('--accent-3', DEFAULT_BRAND_COLORS.glow3);

  const ambientWrap = document.getElementById('ambient-blur-container');
  if (ambientWrap) ambientWrap.classList.remove('active');
}

// 2. НАВІГАЦІЯ ТА РОУТЕР
function showView(viewId, pushHistory = true) {
  const currentActive = document.querySelector('.view:not(.hidden)');
  if (currentActive && currentActive.id !== 'view-rating' && currentActive.id !== viewId) {
    State.previousView = currentActive.id;
  }

  if (viewId !== 'view-rating') {
    resetSiteTheme();
  }

  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (pushHistory && viewId === 'view-home') {
    history.pushState(null, '', window.location.pathname);
  }
}

function initRouter() {
  document.getElementById('btn-home').addEventListener('click', () => {
    stopTrackAudio();
    showView('view-home');
  });

  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      stopTrackAudio();
      showView(State.previousView || 'view-home');
    });
  });

  document.getElementById('btn-profile-toggle').addEventListener('click', () => {
    stopTrackAudio();
    updateProfileView();
    showView('view-profile');
  });

  document.getElementById('btn-cancel-rating').addEventListener('click', () => {
    stopTrackAudio();
    showView(State.previousView || 'view-home');
  });

  window.addEventListener('popstate', handleUrlRouting);
}

// 3. РОЗУМНЕ ЧИТАННЯ ПОСИЛАНЬ (?album=, ?review=, ?user=)
async function handleUrlRouting() {
  const params = new URLSearchParams(window.location.search);
  const albumId = params.get('album');
  const reviewId = params.get('review');
  const userId = params.get('user');

  if (albumId) {
    await openAlbumPage(albumId, false);
  } else if (reviewId) {
    await openSharedReview(reviewId);
  } else if (userId) {
    await openPublicProfile(userId);
  } else {
    showView('view-home', false);
    loadHomeRecommendations();
    loadLeaderboard();
  }
}

function showToast(text) {
  const toast = document.getElementById('toast-notify');
  toast.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

function copyToClipboard(url, message = 'Посилання скопійовано!') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast(message));
  } else {
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast(message);
  }
}

// 4. ОКРЕМА СТОРІНКА АЛЬБОМУ З ПОСИЛАННЯМ
async function openAlbumPage(albumId, updateUrl = true) {
  stopTrackAudio();
  showView('view-album-details', false);
  if (updateUrl) {
    history.pushState(null, '', `?album=${albumId}`);
  }

  const container = document.getElementById('album-page-tracks');
  container.innerHTML = '<p class="item-sub">Завантаження треклісту...</p>';

  const album = await MusicAPI.getAlbumWithTracks(albumId);
  if (!album) {
    container.innerHTML = '<p class="item-sub">Не вдалося знайти альбом.</p>';
    return;
  }

  document.getElementById('album-page-cover').src = album.artwork;
  document.getElementById('album-page-title').textContent = album.title;
  const artistEl = document.getElementById('album-page-artist');
  artistEl.textContent = album.artist;
  artistEl.onclick = () => openFullSearch(album.artist);
  document.getElementById('album-page-genre').textContent = album.genre;

  document.getElementById('btn-start-album-rating').onclick = () => {
    startAlbumRating(album.id);
  };

  document.getElementById('btn-share-album').onclick = () => {
    const url = `${window.location.origin}${window.location.pathname}?album=${album.id}`;
    copyToClipboard(url, 'Посилання на альбом скопійовано!');
  };

  container.innerHTML = '';
  album.tracks.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'album-track-row';
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="color: var(--color-text-muted); font-weight: 700; width: 20px;">${idx + 1}</span>
        <span style="font-weight: 600;">${t.title}</span>
      </div>
      <button class="btn btn-inactive" style="padding: 6px 14px; font-size: 0.82rem;">Оцінити трек</button>
    `;
    row.querySelector('button').onclick = () => {
      startSingleTrackRating({
        id: t.id,
        title: t.title,
        artist: album.artist,
        albumTitle: album.title,
        genre: album.genre,
        artwork: album.artwork,
        previewUrl: t.previewUrl
      });
    };
    container.appendChild(row);
  });
}

// 5. ВІДКРИТТЯ ВІДПОВІДЕЙ КОРИСТУВАЧА ЗА ПОСИЛАННЯМ (?review=)
async function openSharedReview(reviewId) {
  stopTrackAudio();
  State.activeReviewId = reviewId;

  // Шукаємо в локальній історії або в базі
  let review = State.ratingsHistory.find(h => String(h.id || h.albumId) === String(reviewId));

  if (!review && supabaseClient) {
    const { data } = await supabaseClient.from('ratings').select('*').eq('id', reviewId).maybeSingle();
    if (data) {
      review = {
        id: data.id,
        albumId: data.album_id,
        title: data.title,
        artist: data.artist,
        genre: data.genre,
        artwork: data.artwork,
        avgScore: Number(data.avg_score),
        date: new Date(data.created_at).toLocaleDateString('uk-UA'),
        username: data.username || 'Користувач',
        userId: data.user_id,
        isSingleTrack: data.is_single_track,
        tracks: data.tracks || []
      };
    }
  }

  if (review) {
    renderSummaryView(review, true, true);
  } else {
    showView('view-home');
    showToast('Оцінку не знайдено.');
  }
}

// 6. ПУБЛІЧНИЙ ПРОФІЛЬ ЮЗЕРА (?user=)
async function openPublicProfile(userId) {
  stopTrackAudio();
  showView('view-public-profile', false);
  history.pushState(null, '', `?user=${userId}`);

  const list = document.getElementById('pub-history-list');
  list.innerHTML = '<p class="item-sub">Завантаження оцінок...</p>';

  let userRatings = [];
  let username = 'Користувач';

  if (supabaseClient) {
    const { data } = await supabaseClient
      .from('ratings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data && data.length) {
      userRatings = data;
      username = data[0].username || 'Користувач';
    }
  }

  document.getElementById('pub-username').textContent = `@${username}`;
  document.getElementById('pub-stat-count').textContent = userRatings.length;

  if (userRatings.length) {
    const avg = (userRatings.reduce((acc, r) => acc + Number(r.avg_score), 0) / userRatings.length).toFixed(1);
    const avgEl = document.getElementById('pub-stat-avg');
    avgEl.textContent = (avg === '10.0' ? '10' : avg);
    avgEl.style.color = getScoreColor(Number(avg));
  } else {
    document.getElementById('pub-stat-avg').textContent = '0.0';
  }

  document.getElementById('btn-share-user-profile').onclick = () => {
    const url = `${window.location.origin}${window.location.pathname}?user=${userId}`;
    copyToClipboard(url, 'Посилання на профіль скопійовано!');
  };

  list.innerHTML = '';
  if (!userRatings.length) {
    list.innerHTML = '<p class="item-sub">Цей користувач ще не зробив оцінок.</p>';
    return;
  }

  userRatings.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-item-card frosted';
    const scoreColor = getScoreColor(item.avg_score);
    const scoreText = (item.avg_score === 10) ? '10' : Number(item.avg_score).toFixed(1);

    card.innerHTML = `
      <img src="${item.artwork || 'icons/album-placeholder.svg'}" class="history-thumb" alt="" onerror="this.src='icons/album-placeholder.svg'">
      <div class="item-info">
        <span class="item-title">${item.title}</span>
        <span class="item-sub">${item.artist}</span>
        <span class="history-date">${new Date(item.created_at).toLocaleDateString('uk-UA')}</span>
      </div>
      <span class="score-badge-val" style="color: ${scoreColor}; background: ${scoreColor}18;">${scoreText}</span>
    `;

    card.addEventListener('click', () => {
      openSharedReview(item.id);
    });

    list.appendChild(card);
  });
}

// 7. ЛІДЕРБОРД АКТИВНОСТІ НА ГОЛОВНІЙ
async function loadLeaderboard() {
  const container = document.getElementById('home-leaderboard-list');
  if (!supabaseClient) {
    container.innerHTML = '<p class="item-sub">Топ доступний при підключенні бази.</p>';
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('ratings')
      .select('user_id, username');

    if (error || !data || !data.length) {
      container.innerHTML = '<p class="item-sub">Поки немає активних оцінювачів.</p>';
      return;
    }

    const counts = {};
    const names = {};

    data.forEach(r => {
      counts[r.user_id] = (counts[r.user_id] || 0) + 1;
      names[r.user_id] = r.username || 'Користувач';
    });

    const sortedUsers = Object.keys(counts)
      .map(uid => ({ userId: uid, username: names[uid], count: counts[uid] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    container.innerHTML = '';
    sortedUsers.forEach((u, idx) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.innerHTML = `
        <span class="leaderboard-rank">#${idx + 1}</span>
        <span class="leaderboard-user">@${u.username}</span>
        <span class="leaderboard-count">${u.count} оцінок</span>
      `;
      row.onclick = () => openPublicProfile(u.userId);
      container.appendChild(row);
    });
  } catch (err) {
    container.innerHTML = '<p class="item-sub">Помилка завантаження топу.</p>';
  }
}

// 8. НАЛАШТУВАННЯ ТА ЗБЕРЕЖЕННЯ ЮЗЕРНЕЙМУ
function initProfileSettings() {
  const input = document.getElementById('profile-username-input');
  const saveBtn = document.getElementById('btn-save-username');

  input.value = State.username;

  saveBtn.addEventListener('click', async () => {
    const newName = input.value.trim() || 'Користувач';
    State.username = newName;
    localStorage.setItem('songrate_username', newName);

    if (supabaseClient && State.user) {
      await supabaseClient.auth.updateUser({
        data: { username: newName }
      });
      // Оновлюємо в останніх оцінках
      await supabaseClient
        .from('ratings')
        .update({ username: newName })
        .eq('user_id', State.user.id);
    }

    showToast('Юзернейм збережено!');
    loadLeaderboard();
  });
}

function initSharingButtons() {
  document.getElementById('btn-share-review').addEventListener('click', () => {
    if (!State.lastSummaryResult) return;
    const revId = State.lastSummaryResult.id || State.lastSummaryResult.albumId;
    const url = `${window.location.origin}${window.location.pathname}?review=${revId}`;
    copyToClipboard(url, 'Посилання на твій результат скопійовано!');
  });
}

// 9. РЕКОМЕНДАЦІЇ НА ГОЛОВНІЙ
function initRecommendationsRefresh() {
  const refreshBtn = document.getElementById('btn-refresh-recommendations');
  if (!refreshBtn) return;

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('is-refreshing');
    await loadHomeRecommendations();
    setTimeout(() => refreshBtn.classList.remove('is-refreshing'), 600);
  });
}

async function loadHomeRecommendations() {
  const grid = document.getElementById('recommendations-grid');
  const subtitle = document.getElementById('home-subtitle');
  grid.innerHTML = '<p style="color: var(--color-text-muted); grid-column: 1 / -1;">Завантаження нових релізів...</p>';

  const userTopGenres = getTopGenres();
  const ratedAlbumIds = new Set(State.ratingsHistory.map(h => Number(h.albumId)));

  let selectedPool = [];

  if (userTopGenres.length > 0) {
    subtitle.textContent = 'Зібрано на основі твоїх улюблених жанрів';
    userTopGenres.slice(0, 3).forEach(genre => {
      const match = Object.keys(GENRE_ARTIST_MAP).find(k => k.toLowerCase() === genre.toLowerCase());
      if (match) {
        selectedPool.push(...GENRE_ARTIST_MAP[match]);
      } else {
        selectedPool.push(genre);
      }
    });
  } else {
    subtitle.textContent = 'Підібрано для тебе';
  }

  // Запас артистів для 12 плиток
  if (selectedPool.length < 15) {
    const all = Object.values(GENRE_ARTIST_MAP).flat();
    selectedPool = [...selectedPool, ...all];
  }

  // Беремо 12 різних запитів
  const shuffledQueries = [...new Set(selectedPool)].sort(() => Math.random() - 0.5).slice(0, 12);

  try {
    const searchPromises = shuffledQueries.map(term => MusicAPI.search(term, 8));
    const resultsArray = await Promise.all(searchPromises);

    const albums = [];
    const seenAlbumIds = new Set();
    const seenArtists = new Set();

    resultsArray.forEach(results => {
      for (const item of results) {
        const albumId = item.collectionId;
        const artist = (item.artistName || '').trim();
        const normArtist = artist.toLowerCase();

        if (
          albumId &&
          item.collectionName &&
          !seenAlbumIds.has(albumId) &&
          !ratedAlbumIds.has(albumId) &&
          !seenArtists.has(normArtist)
        ) {
          seenAlbumIds.add(albumId);
          seenArtists.add(normArtist);
          const rawArt = item.artworkUrl100 || '';
          albums.push({
            id: albumId,
            title: item.collectionName,
            artist: artist,
            artwork: rawArt ? rawArt.replace('100x100bb', '600x600bb') : 'icons/album-placeholder.svg'
          });
          break;
        }
      }
    });

    grid.innerHTML = '';

    if (!albums.length) {
      grid.innerHTML = '<p style="color: var(--color-text-muted); grid-column: 1 / -1;">Не вдалося отримати релізи. Спробуй ще раз.</p>';
      return;
    }

    // Рендеримо 12 карток
    albums.slice(0, 12).forEach(album => {
      const card = document.createElement('div');
      card.className = 'music-card frosted';
      card.innerHTML = `
        <img src="${album.artwork}" alt="${album.title}" class="card-thumb" onerror="this.src='icons/album-placeholder.svg'">
        <div class="card-title">${album.title}</div>
        <div class="card-artist">${album.artist}</div>
        <button class="btn btn-inactive btn-rate-album">Оцінити альбом</button>
      `;

      card.querySelector('.card-thumb').onclick = () => openAlbumPage(album.id);
      card.querySelector('.card-title').onclick = () => openAlbumPage(album.id);
      card.querySelector('.card-artist').onclick = () => openFullSearch(album.artist);

      card.querySelector('.btn-rate-album').addEventListener('click', (e) => {
        e.stopPropagation();
        startAlbumRating(album.id);
      });
      grid.appendChild(card);
    });

  } catch (err) {
    grid.innerHTML = '<p style="color: var(--color-text-muted); grid-column: 1 / -1;">Помилка завантаження.</p>';
  }
}

// 10. ПОШУК ТА ТАБИ
function initSearch() {
  const input = document.getElementById('search-input');
  const dropdown = document.getElementById('search-dropdown');
  let debounceTimeout;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    const q = input.value.trim();
    if (q.length < 2) {
      dropdown.classList.add('hidden');
      return;
    }
    debounceTimeout = setTimeout(async () => {
      const results = await MusicAPI.search(q, 8);
      renderDropdown(results);
    }, 280);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openFullSearch(input.value.trim());
  });

  document.getElementById('btn-search-submit').addEventListener('click', () => {
    openFullSearch(input.value.trim());
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  document.querySelectorAll('.search-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.search-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterSearchResults(btn.dataset.tab);
    });
  });
}

function getItemType(it) {
  if (it.wrapperType === 'artist') return 'artist';
  if (it.kind === 'song' || it.wrapperType === 'track') return 'track';
  return 'album';
}

function renderDropdown(items) {
  const dropdown = document.getElementById('search-dropdown');
  dropdown.innerHTML = '';
  if (!items.length) {
    dropdown.classList.add('hidden');
    return;
  }

  items.forEach(it => {
    const type = getItemType(it);
    const el = document.createElement('div');
    el.className = 'dropdown-item';

    const title = it.trackName || it.collectionName || it.artistName;
    const sub = it.artistName || 'Артист';
    const fallback = type === 'artist' ? 'icons/artist-placeholder.svg' : 'icons/album-placeholder.svg';
    const img = it.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', '200x200bb') : fallback;
    const typeBadge = type === 'artist' ? 'Артист' : (type === 'track' ? 'Трек' : 'Альбом');

    el.innerHTML = `
      <img src="${img}" alt="" onerror="this.src='${fallback}'">
      <div class="item-info">
        <span class="item-title">${title}</span>
        <span class="item-sub">${sub}</span>
      </div>
      <span class="type-pill">${typeBadge}</span>
    `;

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dropdown.classList.add('hidden');
      handleSearchItemClick(it, type);
    });

    dropdown.appendChild(el);
  });

  dropdown.classList.remove('hidden');
}

async function openFullSearch(query) {
  if (!query) return;
  document.getElementById('search-dropdown').classList.add('hidden');
  showView('view-search');
  document.getElementById('search-query-label').textContent = `Результати для "${query}"`;

  const container = document.getElementById('search-full-results');
  container.innerHTML = '<p style="color: var(--color-text-muted);">Пошук...</p>';

  const items = await MusicAPI.search(query, 50);
  State.lastSearchResults = items;
  filterSearchResults('all');
}

function filterSearchResults(tab) {
  const container = document.getElementById('search-full-results');
  container.innerHTML = '';

  const filtered = State.lastSearchResults.filter(it => {
    const type = getItemType(it);
    if (tab === 'artists') return type === 'artist';
    if (tab === 'albums') return type === 'album';
    if (tab === 'tracks') return type === 'track';
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = '<p style="color: var(--color-text-muted); padding: 16px 0;">Нічого не знайдено у цій категорії.</p>';
    return;
  }

  filtered.forEach(it => {
    const type = getItemType(it);
    const row = document.createElement('div');
    row.className = 'dropdown-item frosted';
    row.style.marginBottom = '8px';

    const title = it.trackName || it.collectionName || it.artistName;
    const sub = type === 'artist' ? (it.primaryGenreName || 'Виконавець') : it.artistName;
    const fallback = type === 'artist' ? 'icons/artist-placeholder.svg' : 'icons/album-placeholder.svg';
    const img = it.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', '200x200bb') : fallback;
    const typeBadge = type === 'artist' ? 'Артист' : (type === 'track' ? 'Трек' : 'Альбом');

    row.innerHTML = `
      <img src="${img}" alt="" onerror="this.src='${fallback}'">
      <div class="item-info">
        <span class="item-title">${title}</span>
        <span class="item-sub">${sub}</span>
      </div>
      <span class="type-pill">${typeBadge}</span>
      <button class="btn btn-inactive" style="flex-shrink: 0; padding: 8px 18px; margin-left: 10px;">
        ${type === 'artist' ? 'Переглянути' : 'Оцінити'}
      </button>
    `;

    row.addEventListener('click', () => handleSearchItemClick(it, type));
    container.appendChild(row);
  });
}

function handleSearchItemClick(it, type) {
  if (type === 'artist') {
    openArtistView(it.artistId, it.artistName, it.primaryGenreName);
  } else if (type === 'track') {
    startSingleTrackRating({
      id: it.trackId,
      title: it.trackName,
      artist: it.artistName,
      albumTitle: it.collectionName || 'Сингл',
      genre: it.primaryGenreName || 'Музика',
      artwork: it.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', '1000x1000bb') : 'icons/album-placeholder.svg',
      previewUrl: it.previewUrl
    });
  } else {
    openAlbumPage(it.collectionId);
  }
}

// 11. СТОРІНКА АРТИСТА
async function openArtistView(artistId, name, genre) {
  showView('view-artist');
  document.getElementById('artist-name').textContent = name;
  document.getElementById('artist-genre').textContent = genre || 'Музика';

  document.getElementById('artist-albums').innerHTML = '<p class="item-sub">Завантаження...</p>';
  document.getElementById('artist-eps').innerHTML = '';
  document.getElementById('artist-singles').innerHTML = '';

  const disc = await MusicAPI.getArtistDiscography(artistId);
  renderReleaseList('artist-albums', disc.albums, 'album');
  renderReleaseList('artist-eps', disc.eps, 'album');
  renderReleaseList('artist-singles', disc.singles, 'single');
}

function renderReleaseList(containerId, list, kind) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<p class="item-sub" style="grid-column: 1 / -1;">Немає записів у цьому розділі</p>';
    return;
  }
  list.forEach(rel => {
    const card = document.createElement('div');
    card.className = 'music-card frosted';
    card.innerHTML = `
      <img src="${rel.artwork}" class="card-thumb" alt="" onerror="this.src='icons/album-placeholder.svg'">
      <div class="card-title">${rel.title}</div>
      <div class="card-artist">${rel.artist}</div>
      <button class="btn btn-inactive">${kind === 'single' ? 'Оцінити трек' : 'Оцінити альбом'}</button>
    `;

    card.querySelector('.card-thumb').onclick = () => openAlbumPage(rel.id);
    card.querySelector('.card-title').onclick = () => openAlbumPage(rel.id);

    card.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      if (kind === 'single') {
        startSingleTrackRating({
          id: rel.id,
          title: rel.title,
          artist: rel.artist,
          albumTitle: rel.title,
          genre: rel.genre,
          artwork: rel.artwork,
          previewUrl: null
        });
      } else {
        startAlbumRating(rel.id);
      }
    });
    box.appendChild(card);
  });
}

// 12. СТАРТ ОЦІНЮВАННЯ
async function startAlbumRating(albumId) {
  stopTrackAudio();
  const albumData = await MusicAPI.getAlbumWithTracks(albumId);
  if (!albumData || !albumData.tracks.length) {
    alert('Не вдалося завантажити треки альбому.');
    return;
  }

  State.isSingleTrackMode = false;
  State.currentAlbum = albumData;
  State.currentTrackIndex = 0;
  State.currentTrackRatings = {};

  MusicAPI.extractColorsFromImage(albumData.artwork, applyDynamicSiteTheme);

  const ambientWrap = document.getElementById('ambient-blur-container');
  const ambientImg = document.getElementById('ambient-blur-cover');
  if (ambientWrap && ambientImg) {
    ambientImg.src = albumData.artwork;
    ambientWrap.classList.add('active');
  }

  document.getElementById('summary-album-cover').src = albumData.artwork;
  document.getElementById('rating-cover-img').src = albumData.artwork;
  document.getElementById('rating-album-title').textContent = albumData.title;
  document.getElementById('rating-mode-tag').textContent = `Альбом • ${albumData.artist}`;

  document.getElementById('btn-prev-track').style.display = 'flex';
  showView('view-rating');
  loadTrackForRating(0);
}

function startSingleTrackRating(trackData) {
  stopTrackAudio();
  State.isSingleTrackMode = true;
  State.currentAlbum = {
    id: trackData.id,
    title: trackData.albumTitle || trackData.title,
    artist: trackData.artist,
    genre: trackData.genre,
    artwork: trackData.artwork,
    tracks: [{
      id: trackData.id,
      title: trackData.title,
      previewUrl: trackData.previewUrl
    }]
  };
  State.currentTrackIndex = 0;
  State.currentTrackRatings = {};

  MusicAPI.extractColorsFromImage(trackData.artwork, applyDynamicSiteTheme);

  const ambientWrap = document.getElementById('ambient-blur-container');
  const ambientImg = document.getElementById('ambient-blur-cover');
  if (ambientWrap && ambientImg) {
    ambientImg.src = trackData.artwork;
    ambientWrap.classList.add('active');
  }

  document.getElementById('summary-album-cover').src = trackData.artwork;
  document.getElementById('rating-cover-img').src = trackData.artwork;
  document.getElementById('rating-album-title').textContent = `${trackData.artist} — Сингл`;
  document.getElementById('rating-mode-tag').textContent = `Окремий трек • ${trackData.artist}`;

  document.getElementById('btn-prev-track').style.display = 'none';
  showView('view-rating');
  loadTrackForRating(0);
}

function loadTrackForRating(idx) {
  const tracks = State.currentAlbum.tracks;
  const track = tracks[idx];

  if (State.isSingleTrackMode) {
    document.getElementById('rating-step-counter').textContent = 'Окремий трек';
  } else {
    document.getElementById('rating-step-counter').textContent = `Трек ${idx + 1} з ${tracks.length}`;
  }

  document.getElementById('rating-track-title').textContent = track.title;

  const savedScore = State.currentTrackRatings[track.id];
  if (savedScore === undefined) {
    State.isUnrated = true;
    updateLiquidSliderPosition(0, true);
    setRollerValue(0, true);
  } else {
    State.isUnrated = false;
    updateLiquidSliderPosition(savedScore, true);
    setRollerValue(savedScore, false);
  }

  document.getElementById('btn-prev-track').disabled = (idx === 0);
  const nextIcon = document.getElementById('next-track-icon');
  if (idx === tracks.length - 1 || State.isSingleTrackMode) {
    nextIcon.src = 'icons/check.svg';
  } else {
    nextIcon.src = 'icons/next.svg';
  }

  playTrackAudio(track.previewUrl);
}

// 13. МАГНІТНИЙ РІДКИЙ СЛАЙДЕР
function initMagneticLiquidSlider() {
  const container = document.getElementById('liquid-slider-container');
  const track = document.getElementById('liquid-slider-track');
  const thumb = document.getElementById('liquid-slider-thumb');
  const fill = document.getElementById('liquid-slider-fill');
  const bubble = document.getElementById('score-display-wrap');

  let isDragging = false;
  let lastX = 0;
  let currentContinuousVal = 0;

  function getRawValFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = offsetX / rect.width;
    return Math.max(0, Math.min(10, percent * 10));
  }

  function handleMove(e) {
    if (!isDragging) return;
    if (window.getSelection) window.getSelection().removeAllRanges();

    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const deltaX = clientX - lastX;
    lastX = clientX;

    const stretch = Math.min(Math.abs(deltaX) * 0.04, 0.45);
    const core = thumb.querySelector('.liquid-thumb-core');
    if (core) core.style.transform = `scale(${1.25 + stretch}, ${1.25 - stretch * 0.6})`;

    currentContinuousVal = getRawValFromEvent(e);
    State.isUnrated = false;

    updateLiquidSliderPosition(currentContinuousVal, false);

    const previewStepped = Math.round(currentContinuousVal * 2) / 2;
    setRollerValue(previewStepped, false);
  }

  function startDrag(e) {
    isDragging = true;
    container.classList.add('is-dragging');
    document.body.classList.add('is-slider-active');

    fill.classList.remove('is-snapping');
    thumb.classList.remove('is-snapping');
    if (bubble) bubble.classList.remove('is-snapping');

    lastX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    handleMove(e);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
  }

  function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    container.classList.remove('is-dragging');
    document.body.classList.remove('is-slider-active');

    const core = thumb.querySelector('.liquid-thumb-core');
    if (core) core.style.transform = '';

    const snappedVal = Math.round(currentContinuousVal * 2) / 2;
    State.currentScoreValue = snappedVal;

    const currentTrack = State.currentAlbum.tracks[State.currentTrackIndex];
    State.currentTrackRatings[currentTrack.id] = snappedVal;

    updateLiquidSliderPosition(snappedVal, true);
    setRollerValue(snappedVal, false);

    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', stopDrag);
  }

  container.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startDrag(e);
  });
}

function updateLiquidSliderPosition(val, withSnapAnimation = false) {
  const fill = document.getElementById('liquid-slider-fill');
  const thumb = document.getElementById('liquid-slider-thumb');
  const bubble = document.getElementById('score-display-wrap');
  const track = document.getElementById('liquid-slider-track');
  const percent = (val / 10) * 100;

  if (withSnapAnimation) {
    fill.classList.add('is-snapping');
    thumb.classList.add('is-snapping');
    if (bubble) bubble.classList.add('is-snapping');
  } else {
    fill.classList.remove('is-snapping');
    thumb.classList.remove('is-snapping');
    if (bubble) bubble.classList.remove('is-snapping');
  }

  fill.style.width = `${percent}%`;
  thumb.style.left = `${percent}%`;

  if (bubble && track) {
    const trackWidth = track.offsetWidth || track.getBoundingClientRect().width;
    const BUBBLE_WIDTH = 140;

    if (trackWidth > 0) {
      const thumbPixelX = (percent / 100) * trackWidth;
      let targetLeft = thumbPixelX - (BUBBLE_WIDTH / 2);
      const minLeft = 0;
      const maxLeft = Math.max(0, trackWidth - BUBBLE_WIDTH);
      targetLeft = Math.max(minLeft, Math.min(maxLeft, targetLeft));
      bubble.style.left = `${targetLeft}px`;
    }
  }
}

function setRollerValue(val, isUnrated = false) {
  const displayWrap = document.getElementById('score-display-wrap');
  const odometerBox = document.getElementById('odometer-roller-box');
  const rollerTens = document.getElementById('roller-tens');
  const rollerInt = document.getElementById('roller-int');
  const rollerDec = document.getElementById('roller-dec');
  const core = document.querySelector('.liquid-thumb-core');
  const ROLLER_H = 54;

  if (isUnrated) {
    displayWrap.classList.add('unrated');
    odometerBox.classList.remove('is-ten');
    rollerTens.classList.remove('visible');
    rollerInt.style.transform = `translateY(0px)`;
    rollerDec.style.transform = `translateY(0px)`;
    if (core) {
      core.style.borderColor = 'var(--color-purple)';
      core.style.boxShadow = '0 0 16px rgba(139, 92, 246, 0.9)';
    }
    return;
  }

  displayWrap.classList.remove('unrated');

  const isTen = (val === 10.0);
  if (isTen) {
    odometerBox.classList.add('is-ten');
    rollerTens.classList.add('visible');
    rollerInt.style.transform = `translateY(-${10 * ROLLER_H}px)`;
  } else {
    odometerBox.classList.remove('is-ten');
    rollerTens.classList.remove('visible');
    const intDigit = Math.floor(val);
    rollerInt.style.transform = `translateY(-${intDigit * ROLLER_H}px)`;
  }

  const decPart = Math.round((val - Math.floor(val)) * 10);
  const decIndex = decPart >= 5 ? 1 : 0;
  rollerDec.style.transform = `translateY(-${decIndex * ROLLER_H}px)`;

  const color = getScoreColor(val);
  const glow = (val === 10.0) ? '0 0 24px rgba(251, 191, 36, 0.6)' : 'none';

  displayWrap.style.color = color;
  displayWrap.style.filter = glow !== 'none' ? `drop-shadow(${glow})` : 'none';
  displayWrap.style.borderColor = color + '55';

  if (core) {
    core.style.borderColor = color;
    core.style.boxShadow = `0 0 18px ${color}, 0 0 30px ${color}80`;
  }
}

// 14. ГУЧНІСТЬ
function initVolumeControls() {
  const wrap = document.getElementById('volume-control-wrap');
  const toggleBtn = document.getElementById('btn-volume-toggle');
  const popup = document.getElementById('volume-popup');
  const volTrack = document.getElementById('liquid-vol-track');
  const volFill = document.getElementById('liquid-vol-fill');
  const volThumb = document.getElementById('liquid-vol-thumb');
  const volLabel = document.getElementById('vol-percent-label');

  let isVolDragging = false;

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && !toggleBtn.contains(e.target)) {
      popup.classList.remove('active');
    }
  });

  function applyVolume(percent) {
    const p = Math.max(0, Math.min(1, percent));
    State.volume = p;
    State.audio.volume = p;

    volFill.style.width = `${p * 100}%`;
    volThumb.style.left = `${p * 100}%`;
    volLabel.textContent = `${Math.round(p * 100)}%`;

    if (p === 0) {
      wrap.classList.add('is-muted');
    } else {
      wrap.classList.remove('is-muted');
    }
  }

  function handleVolMove(e) {
    if (!isVolDragging) return;
    const rect = volTrack.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    applyVolume(offsetX / rect.width);
  }

  volTrack.addEventListener('pointerdown', (e) => {
    isVolDragging = true;
    handleVolMove(e);
    window.addEventListener('pointermove', handleVolMove);
    window.addEventListener('pointerup', () => {
      isVolDragging = false;
      window.removeEventListener('pointermove', handleVolMove);
    }, { once: true });
  });

  applyVolume(State.volume);
}

// 15. КНОПКИ ПЛЕЄРА
function initRatingNavButtons() {
  const playbackBtn = document.getElementById('btn-playback-toggle');

  playbackBtn.addEventListener('click', () => {
    if (State.isEnded) {
      State.isEnded = false;
      document.getElementById('cover-image-box').classList.remove('is-ended');
      State.audio.currentTime = 0;
      State.audio.play().then(() => trackPlaybackProgress()).catch(() => {});
      return;
    }

    if (State.isPlaying) {
      State.audio.pause();
    } else {
      State.audio.play().then(() => trackPlaybackProgress()).catch(() => {});
    }
  });

  document.getElementById('btn-prev-track').addEventListener('click', () => {
    if (State.currentTrackIndex > 0) {
      State.currentTrackIndex--;
      loadTrackForRating(State.currentTrackIndex);
    }
  });

  document.getElementById('btn-next-track').addEventListener('click', () => {
    const tracks = State.currentAlbum.tracks;
    const track = tracks[State.currentTrackIndex];

    if (State.currentTrackRatings[track.id] === undefined) {
      State.currentTrackRatings[track.id] = 0.0;
    }

    if (State.isSingleTrackMode || State.currentTrackIndex === tracks.length - 1) {
      finishRating();
    } else {
      State.currentTrackIndex++;
      loadTrackForRating(State.currentTrackIndex);
    }
  });
}

function initAudioEvents() {
  const loader = document.getElementById('track-loader');
  const coverBox = document.getElementById('cover-image-box');
  const playIcon = document.getElementById('play-pause-icon');

  State.audio.addEventListener('loadstart', () => loader.classList.remove('hidden'));
  State.audio.addEventListener('waiting', () => loader.classList.remove('hidden'));
  State.audio.addEventListener('canplay', () => loader.classList.add('hidden'));

  State.audio.addEventListener('playing', () => {
    loader.classList.add('hidden');
    coverBox.classList.remove('is-ended');
    coverBox.classList.add('is-playing');
    State.isPlaying = true;
    State.isEnded = false;
    playIcon.src = 'icons/pause.svg';
  });

  State.audio.addEventListener('pause', () => {
    coverBox.classList.remove('is-playing');
    State.isPlaying = false;
    if (!State.isEnded) playIcon.src = 'icons/play.svg';
  });

  State.audio.addEventListener('ended', () => {
    State.isPlaying = false;
    State.isEnded = true;
    coverBox.classList.remove('is-playing');
    coverBox.classList.add('is-ended');
    playIcon.src = 'icons/replay.svg';
    resetBorderProgress();
  });

  State.audio.addEventListener('error', () => stopTrackAudio());
}

function playTrackAudio(url) {
  stopTrackAudio();
  if (!url) {
    document.getElementById('track-loader').classList.add('hidden');
    return;
  }
  State.audio.src = url;
  State.audio.play().then(() => trackPlaybackProgress()).catch(() => {});
}

function stopTrackAudio() {
  cancelAnimationFrame(State.animFrameId);
  State.audio.pause();
  State.audio.currentTime = 0;
  State.isPlaying = false;
  State.isEnded = false;
  const coverBox = document.getElementById('cover-image-box');
  if (coverBox) {
    coverBox.classList.remove('is-playing');
    coverBox.classList.remove('is-ended');
  }
  const playIcon = document.getElementById('play-pause-icon');
  if (playIcon) playIcon.src = 'icons/play.svg';
  const loader = document.getElementById('track-loader');
  if (loader) loader.classList.add('hidden');
  resetBorderProgress();
}

function resetBorderProgress() {
  const fill = document.getElementById('track-progress-fill');
  if (fill) fill.style.strokeDashoffset = '1000';
}

function trackPlaybackProgress() {
  const fill = document.getElementById('track-progress-fill');
  const maxDash = 1000;

  function loop() {
    if (!State.audio.paused && State.audio.duration) {
      const progress = State.audio.currentTime / State.audio.duration;
      fill.style.strokeDashoffset = (maxDash - (maxDash * progress)).toString();
      State.animFrameId = requestAnimationFrame(loop);
    }
  }
  State.animFrameId = requestAnimationFrame(loop);
}

// 16. ЕКРАН ПІДСУМКІВ
async function renderSummaryView(data, isHistoryMode = false, isExternalReview = false) {
  stopTrackAudio();
  showView('view-summary', false);

  const banner = document.getElementById('shared-review-banner');
  if (isExternalReview && data.username) {
    banner.classList.remove('hidden');
    document.getElementById('shared-user-name').textContent = `@${data.username}`;
    document.getElementById('btn-view-reviewer-profile').onclick = () => {
      openPublicProfile(data.userId || data.user_id);
    };
  } else {
    banner.classList.add('hidden');
  }

  document.getElementById('summary-album-cover').src = data.artwork || 'icons/album-placeholder.svg';
  document.getElementById('summary-album-title').textContent = data.title;
  document.getElementById('summary-album-artist').textContent = data.artist;

  const finalScoreEl = document.getElementById('summary-final-score');
  const avgFmt = (data.avgScore === 10) ? '10' : Number(data.avgScore).toFixed(1);
  finalScoreEl.textContent = avgFmt;
  finalScoreEl.style.color = getScoreColor(data.avgScore);

  // Світіння для фінального бала (тільки для десятки або високих оцінок)
  if (data.avgScore >= 9.9) {
    finalScoreEl.style.textShadow = '0 0 25px rgba(251, 191, 36, 0.8), 0 0 40px rgba(251, 191, 36, 0.4)';
  } else {
    finalScoreEl.style.textShadow = 'none';
  }

  let tracksList = data.tracks;
  if (!tracksList || !tracksList.length) {
    if (data.isSingleTrack || data.title === data.albumTitle) {
      tracksList = [{ id: data.albumId, title: data.title, score: data.avgScore }];
      data.tracks = tracksList;
      localStorage.setItem('songrate_history', JSON.stringify(State.ratingsHistory));
    } else {
      try {
        const albumData = await MusicAPI.getAlbumWithTracks(data.albumId);
        if (albumData && albumData.tracks) {
          tracksList = albumData.tracks.map(t => ({
            id: t.id,
            title: t.title,
            score: data.avgScore
          }));
          data.tracks = tracksList;
          localStorage.setItem('songrate_history', JSON.stringify(State.ratingsHistory));
        }
      } catch (e) {}
    }
  }

  const isSingle = data.isSingleTrack || (tracksList && tracksList.length <= 1);
  const hBox = document.getElementById('summary-highlights-box');
  const tracksTitleEl = document.querySelector('.tracks-summary-container .section-title');

  if (isSingle) {
    hBox.style.display = 'none';
    document.getElementById('summary-badge-label').textContent = 'Оцінка треку';
    if (tracksTitleEl) tracksTitleEl.textContent = 'Оцінений трек';
  } else {
    hBox.style.display = 'grid';
    document.getElementById('summary-badge-label').textContent = 'Загальний бал';
    if (tracksTitleEl) tracksTitleEl.textContent = 'Оцінки всіх треків';

    if (tracksList && tracksList.length > 0) {
      // Фільтруємо скіпи (0.0), щоб вони не ставали "найнижчими"
      const validTracks = tracksList.filter(t => (t.score ?? 0) > 0.0);

      const hiEl = document.getElementById('summary-best-track');
      const lowEl = document.getElementById('summary-lowest-track');
      const bestLabelEl = hBox.querySelector('.highlight-item.best .hl-label');
      const lowLabelEl = hBox.querySelector('.highlight-item.lowest .hl-label');

      if (validTracks.length > 0) {
        // Знаходимо максимальний і мінімальний бал серед не-скіпнутих
        const maxScore = Math.max(...validTracks.map(t => t.score));
        const minScore = Math.min(...validTracks.map(t => t.score));

        // Збираємо всі треки з макс. балом
        const bestTracks = validTracks.filter(t => t.score === maxScore);
        // Збираємо всі треки з мін. балом
        const lowestTracks = validTracks.filter(t => t.score === minScore);

        // Множина найкращих
        if (bestTracks.length > 1) {
          bestLabelEl.textContent = 'Найкращі треки';
          hiEl.textContent = `${bestTracks.map(t => t.title).join(', ')} (${(maxScore === 10) ? '10' : maxScore.toFixed(1)})`;
        } else {
          bestLabelEl.textContent = 'Найкращий трек';
          hiEl.textContent = `${bestTracks[0].title} (${(maxScore === 10) ? '10' : maxScore.toFixed(1)})`;
        }
        hiEl.style.color = getScoreColor(maxScore);

        // Множина найнижчих
        if (lowestTracks.length > 1) {
          lowLabelEl.textContent = 'Найнижчі бали';
          lowEl.textContent = `${lowestTracks.map(t => t.title).join(', ')} (${(minScore === 10) ? '10' : minScore.toFixed(1)})`;
        } else {
          lowLabelEl.textContent = 'Найнижчий бал';
          lowEl.textContent = `${lowestTracks[0].title} (${(minScore === 10) ? '10' : minScore.toFixed(1)})`;
        }
        lowEl.style.color = getScoreColor(minScore);
      } else {
        bestLabelEl.textContent = 'Найкращий трек';
        lowLabelEl.textContent = 'Найнижчий бал';
        hiEl.textContent = 'Всі треки скіпнуті';
        lowEl.textContent = 'Всі треки скіпнуті';
      }
    }
  }

  const listContainer = document.getElementById('summary-tracks-list');
  listContainer.innerHTML = '';

  if (tracksList && tracksList.length) {
    tracksList.forEach(t => {
      const s = t.score ?? data.avgScore;
    const scoreColor = getScoreColor(s);
    const scoreText = (s === 10) ? '10' : Number(s).toFixed(1);
    const isTen = (s >= 9.9);

    const row = document.createElement('div');
    row.className = 'summary-row';
    row.innerHTML = `
      <span>${t.title}</span>
      <span class="score-badge-val" style="color: ${scoreColor}; background: ${scoreColor}18; border-color: ${scoreColor}40; ${isTen ? 'box-shadow: 0 0 16px rgba(251, 191, 36, 0.5); text-shadow: 0 0 10px rgba(251, 191, 36, 0.7);' : ''}">${scoreText}</span>
    `;
      listContainer.appendChild(row);
    });
  }

  const reRateBtn = document.getElementById('btn-re-rate');
  reRateBtn.onclick = () => {
    if (data.isSingleTrack) {
      startSingleTrackRating({
        id: data.albumId,
        title: data.title,
        artist: data.artist,
        albumTitle: data.title,
        genre: data.genre,
        artwork: data.artwork,
        previewUrl: data.previewUrl || null
      });
    } else {
      startAlbumRating(data.albumId);
    }
  };

  const saveBtn = document.getElementById('btn-save-summary');
  if (isHistoryMode) {
    saveBtn.innerHTML = `<img src="icons/check.svg" class="svg-icon btn-icon"> Закрити перегляд`;
    saveBtn.onclick = () => showView(State.previousView || 'view-profile');
  } else {
    saveBtn.innerHTML = `Зберегти в історію`;
    saveBtn.onclick = async () => {
      await saveRatingToStorage();
      showView('view-home');
      loadHomeRecommendations();
    };
  }
}

function finishRating() {
  const tracks = State.currentAlbum.tracks;
  let sum = 0;
  let count = 0; // Рахуємо лише оцінені треки (не скіпнуті)

  const ratedTracks = tracks.map(t => {
    const s = State.currentTrackRatings[t.id] ?? 0.0;
    if (s > 0.0) {
      sum += s;
      count++;
    }
    return { id: t.id, title: t.title, score: s };
  });

  // Якщо всі треки скіпнуті (0.0), середній бал стає 0.0, інакше рахуємо середнє лише по оцінених
  const avgRaw = count > 0 ? (sum / count) : 0.0;
  const avg = parseFloat(avgRaw.toFixed(1));

  const now = new Date();
  const dateFormatted = now.toLocaleDateString('uk-UA', { 
    day: '2-digit', month: '2-digit', year: 'numeric' 
  }) + ' ' + now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

  const localId = 'rev_' + Date.now();
  const numericAlbumId = typeof State.currentAlbum.id === 'number' ? State.currentAlbum.id : Date.now();

  State.lastSummaryResult = {
    id: localId,
    albumId: numericAlbumId,
    title: State.currentAlbum.title,
    artist: State.currentAlbum.artist,
    genre: State.currentAlbum.genre,
    artwork: State.currentAlbum.artwork,
    avgScore: avg,
    date: dateFormatted,
    username: State.username,
    isSingleTrack: State.isSingleTrackMode,
    previewUrl: tracks[0]?.previewUrl || null,
    tracks: ratedTracks
  };

  renderSummaryView(State.lastSummaryResult, false);
}

async function saveRatingToStorage() {
  if (!State.lastSummaryResult) return;
  State.ratingsHistory.unshift(State.lastSummaryResult);
  localStorage.setItem('songrate_history', JSON.stringify(State.ratingsHistory));

  if (supabaseClient && State.user) {
    try {
      const { data } = await supabaseClient.from('ratings').insert({
        user_id: State.user.id,
        album_id: State.lastSummaryResult.albumId,
        title: State.lastSummaryResult.title,
        artist: State.lastSummaryResult.artist,
        genre: State.lastSummaryResult.genre,
        artwork: State.lastSummaryResult.artwork,
        avg_score: State.lastSummaryResult.avgScore,
        username: State.username,
        tracks: State.lastSummaryResult.tracks,
        is_single_track: State.lastSummaryResult.isSingleTrack
      }).select().single();

      if (data) {
        State.lastSummaryResult.id = data.id;
        localStorage.setItem('songrate_history', JSON.stringify(State.ratingsHistory));
      }
      loadLeaderboard();
    } catch (err) {
      console.error('Помилка запису в Supabase:', err);
    }
  }

  updateProfileView();
}

// 17. ПРОФІЛЬ ТА ІСТОРІЯ
function getTopGenres() {
  const genreCount = {};
  State.ratingsHistory.forEach(h => {
    if (h.genre && h.avgScore >= 7.0) {
      genreCount[h.genre] = (genreCount[h.genre] || 0) + 1;
    }
  });
  return Object.keys(genreCount).sort((a, b) => genreCount[b] - genreCount[a]);
}

function updateProfileView() {
  const history = State.ratingsHistory;
  document.getElementById('stat-total-ratings').textContent = history.length;

  if (history.length) {
    const rawTotal = history.reduce((acc, h) => acc + h.avgScore, 0) / history.length;
    const avgEl = document.getElementById('stat-avg-score');
    avgEl.textContent = (rawTotal === 10) ? '10' : rawTotal.toFixed(1);
    avgEl.style.color = getScoreColor(rawTotal);
  } else {
    document.getElementById('stat-avg-score').textContent = '0.0';
  }

  const top = getTopGenres().slice(0, 5);
  const chipsWrap = document.getElementById('profile-top-genres');
  chipsWrap.innerHTML = '';
  if (top.length) {
    top.forEach(g => {
      const chip = document.createElement('span');
      chip.className = 'genre-chip';
      chip.textContent = g;
      chipsWrap.appendChild(chip);
    });
  } else {
    chipsWrap.innerHTML = '<span class="genre-chip empty">Поки немає оцінок від 7.0+</span>';
  }

  const histContainer = document.getElementById('profile-history-list');
  histContainer.innerHTML = '';

  if (!history.length) {
    histContainer.innerHTML = '<p style="color: var(--color-text-muted); padding: 12px 0;">Історія оцінок порожня</p>';
    return;
  }

  history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-item-card frosted';
    
    const scoreColor = getScoreColor(item.avgScore);
    const scoreText = (item.avgScore === 10) ? '10' : Number(item.avgScore).toFixed(1);

    card.innerHTML = `
      <img src="${item.artwork || 'icons/album-placeholder.svg'}" class="history-thumb" alt="" onerror="this.src='icons/album-placeholder.svg'">
      <div class="item-info">
        <span class="item-title">${item.title}</span>
        <span class="item-sub">${item.artist}</span>
        <span class="history-date">${item.date || 'Нещодавно'}</span>
      </div>
      <span class="score-badge-val" style="color: ${scoreColor}; background: ${scoreColor}18;">${scoreText}</span>
    `;

    card.addEventListener('click', () => {
      renderSummaryView(item, true);
    });

    histContainer.appendChild(card);
  });
}

// 18. СЕСІЯ ТА АВТОРИЗАЦІЯ
async function checkInitialSession() {
  if (!supabaseClient) return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    applyUserSession(session.user);
    loadUserCloudRatings(session.user.id);
  }
}

function applyUserSession(user) {
  State.user = user;
  const metaName = user.user_metadata?.username;
  if (metaName) {
    State.username = metaName;
    localStorage.setItem('songrate_username', metaName);
    const input = document.getElementById('profile-username-input');
    if (input) input.value = metaName;
  }
  document.getElementById('profile-email').textContent = user.email;
  document.getElementById('btn-auth-action').textContent = 'Вийти';
}

async function loadUserCloudRatings(userId) {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from('ratings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!error && data?.length) {
    const localMap = new Map(State.ratingsHistory.map(h => [h.albumId, h]));
    State.ratingsHistory = data.map(d => {
      const localItem = localMap.get(d.album_id);
      return {
        id: d.id,
        albumId: d.album_id,
        title: d.title,
        artist: d.artist,
        genre: d.genre,
        artwork: d.artwork,
        avgScore: Number(d.avg_score),
        date: localItem?.date || new Date(d.created_at || Date.now()).toLocaleDateString('uk-UA'),
        username: d.username || State.username,
        isSingleTrack: d.is_single_track ?? localItem?.isSingleTrack ?? false,
        tracks: d.tracks || localItem?.tracks || []
      };
    });
    localStorage.setItem('songrate_history', JSON.stringify(State.ratingsHistory));
    updateProfileView();
  }
}

function initAuth() {
  const modal = document.getElementById('modal-auth');
  const btnOpen = document.getElementById('btn-auth-action');
  const btnClose = document.getElementById('btn-close-auth');
  const form = document.getElementById('auth-form');
  const errBox = document.getElementById('auth-error-msg');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const submitBtn = document.getElementById('btn-auth-submit');
  const title = document.getElementById('auth-title');

  btnOpen.addEventListener('click', async () => {
    if (State.user) {
      if (supabaseClient) await supabaseClient.auth.signOut();
      State.user = null;
      document.getElementById('profile-email').textContent = 'Локальний профіль';
      btnOpen.textContent = 'Увійти / Реєстрація';
    } else {
      errBox.classList.add('hidden');
      modal.classList.remove('hidden');
    }
  });

  btnClose.addEventListener('click', () => modal.classList.add('hidden'));

  tabLogin.addEventListener('click', () => {
    State.authMode = 'login';
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    title.textContent = 'Вхід в SongRate';
    submitBtn.textContent = 'Увійти';
    errBox.classList.add('hidden');
  });

  tabRegister.addEventListener('click', () => {
    State.authMode = 'register';
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    title.textContent = 'Реєстрація в SongRate';
    submitBtn.textContent = 'Створити акаунт';
    errBox.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');

    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!supabaseClient) {
      errBox.textContent = 'Вкажи SUPABASE_URL та SUPABASE_ANON_KEY на початку app.js';
      errBox.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Зачекайте...';

    if (State.authMode === 'register') {
      const { data, error } = await supabaseClient.auth.signUp({
        email, 
        password,
        options: { data: { username: State.username } }
      });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Створити акаунт';

      if (error) {
        errBox.textContent = error.message;
        errBox.classList.remove('hidden');
      } else if (data.user) {
        applyUserSession(data.user);
        modal.classList.add('hidden');
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Увійти';

      if (error) {
        errBox.textContent = 'Неправильна пошта або пароль';
        errBox.classList.remove('hidden');
      } else if (data.user) {
        applyUserSession(data.user);
        await loadUserCloudRatings(data.user.id);
        modal.classList.add('hidden');
      }
    }
  });
}
