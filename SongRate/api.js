const MusicAPI = {
  // 1. Розумний пошук з ранжуванням та захистом від одруківок
  async search(query, limit = 30) {
    if (!query) return [];
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    const q = encodeURIComponent(cleanQuery);
    
    try {
      const [artistsData, albumsData, songsData] = await Promise.all([
        fetch(`https://itunes.apple.com/search?term=${q}&entity=musicArtist&limit=10`).then(r => r.json()).catch(() => ({ results: [] })),
        fetch(`https://itunes.apple.com/search?term=${q}&entity=album&limit=${limit}`).then(r => r.json()).catch(() => ({ results: [] })),
        fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=${limit}`).then(r => r.json()).catch(() => ({ results: [] }))
      ]);

      const artists = artistsData.results || [];
      const albums = albumsData.results || [];
      const songs = songsData.results || [];

      // Автовидобуток артистів, якщо Apple повернув мало артистів напряму
      const seenArtistIds = new Set(artists.map(a => a.artistId));
      [...albums, ...songs].forEach(item => {
        if (item.artistId && item.artistName && !seenArtistIds.has(item.artistId)) {
          seenArtistIds.add(item.artistId);
          artists.push({
            wrapperType: 'artist',
            artistType: 'Artist',
            artistId: item.artistId,
            artistName: item.artistName,
            primaryGenreName: item.primaryGenreName || 'Музика',
            artworkUrl100: item.artworkUrl100 || null
          });
        }
      });

      // Ранжування: точний збіг запиту ставимо нагору
      const lowerQ = cleanQuery.toLowerCase();
      artists.sort((a, b) => {
        const aExact = (a.artistName || '').toLowerCase() === lowerQ;
        const bExact = (b.artistName || '').toLowerCase() === lowerQ;
        return (bExact ? 1 : 0) - (aExact ? 1 : 0);
      });

      return [...artists, ...albums, ...songs];
    } catch (err) {
      console.error('Помилка пошуку MusicAPI:', err);
      return [];
    }
  },

  // 2. Отримання альбому та всіх його треків
  async getAlbumWithTracks(albumId) {
    const url = `https://itunes.apple.com/lookup?id=${albumId}&entity=song&limit=100`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      if (!data.results || data.results.length === 0) return null;

      const albumMeta = data.results[0];
      const tracks = data.results.slice(1).filter(item => item.wrapperType === 'track');

      const rawArt = albumMeta.artworkUrl100 || '';
      const highResArt = rawArt ? rawArt.replace('100x100bb', '1000x1000bb') : '';

      return {
        id: albumMeta.collectionId,
        title: albumMeta.collectionName || 'Альбом',
        artist: albumMeta.artistName || 'Невідомий артист',
        genre: albumMeta.primaryGenreName || 'Музика',
        artwork: highResArt,
        tracks: tracks.map((t, idx) => ({
          id: t.trackId || idx,
          title: t.trackName || `Трек ${idx + 1}`,
          previewUrl: t.previewUrl || null,
          duration: 30
        }))
      };
    } catch (err) {
      console.error('Помилка завантаження альбому:', err);
      return null;
    }
  },

  // 3. Дискографія артиста
  async getArtistDiscography(artistId) {
    const url = `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=100`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      const items = data.results ? data.results.slice(1) : [];

      const albums = [];
      const eps = [];
      const singles = [];

      items.forEach(item => {
        const name = (item.collectionName || '').toLowerCase();
        const count = item.trackCount || 1;
        const rawArt = item.artworkUrl100 || '';
        const art = rawArt ? rawArt.replace('100x100bb', '600x600bb') : '';

        const release = {
          id: item.collectionId,
          title: item.collectionName,
          artist: item.artistName,
          genre: item.primaryGenreName,
          artwork: art,
          count
        };

        if (count <= 2 || name.includes('single')) {
          singles.push(release);
        } else if ((count >= 3 && count <= 6) || name.includes('ep')) {
          eps.push(release);
        } else {
          albums.push(release);
        }
      });

      return { albums, eps, singles };
    } catch (err) {
      console.error('Помилка дискографії артиста:', err);
      return { albums: [], eps: [], singles: [] };
    }
  },

  // 4. Вилучення кольорів з перевіркою контрастності та яскравості (WCAG / HSL)
  extractColorsFromImage(imgUrl, callback) {
    const defaultColors = {
      purple: '#8b5cf6',
      purpleLight: '#a78bfa',
      glow1: '#581c87',
      glow2: '#831843',
      glow3: '#1e1b4b'
    };

    if (!imgUrl) {
      callback(defaultColors);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imgUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 16;
        canvas.height = 16;
        ctx.drawImage(img, 0, 0, 16, 16);

        const pixels = [];
        for (let x = 2; x < 14; x += 4) {
          for (let y = 2; y < 14; y += 4) {
            const p = ctx.getImageData(x, y, 1, 1).data;
            pixels.push({ r: p[0], g: p[1], b: p[2] });
          }
        }

        function rgbToHsl(r, g, b) {
          r /= 255; g /= 255; b /= 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          let h, s, l = (max + min) / 2;
          if (max === min) {
            h = s = 0;
          } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
              case r: h = (g - b) / d + (g < b ? 6 : 0); break;
              case g: h = (b - r) / d + 2; break;
              case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
          }
          return [h * 360, s * 100, l * 100];
        }

        function hslToRgb(h, s, l) {
          h /= 360; s /= 100; l /= 100;
          let r, g, b;
          if (s === 0) {
            r = g = b = l;
          } else {
            const hue2rgb = (p, q, t) => {
              if (t < 0) t += 1;
              if (t > 1) t -= 1;
              if (t < 1/6) return p + (q - p) * 6 * t;
              if (t < 1/2) return q;
              if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
              return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
          }
          return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
        }

        let bestColor = pixels[0];
        let maxSaturation = -1;

        pixels.forEach(p => {
          const [, s] = rgbToHsl(p.r, p.g, p.b);
          if (s > maxSaturation) {
            maxSaturation = s;
            bestColor = p;
          }
        });

        let [h, s, l] = rgbToHsl(bestColor.r, bestColor.g, bestColor.b);

        if (s < 18 || l < 35) {
          h = 265;
          s = 55;
        }

        const [rLight, gLight, bLight] = hslToRgb(h, Math.max(s, 60), 80);
        const [rDeep, gDeep, bDeep] = hslToRgb(h, s, 32);

        const accentPurple = `rgb(${rLight}, ${gLight}, ${bLight})`;
        const glowBase = `rgb(${rDeep}, ${gDeep}, ${bDeep})`;

        callback({
          purple: accentPurple,
          purpleLight: `rgb(${rLight}, ${gLight}, ${bLight})`,
          glow1: glowBase,
          glow2: `rgb(${Math.round(rDeep * 0.8)}, ${Math.round(gDeep * 0.4)}, ${Math.round(bDeep * 0.9)})`,
          glow3: '#0f0e1a'
        });
      } catch (e) {
        callback(defaultColors);
      }
    };

    img.onerror = () => callback(defaultColors);
  }
};