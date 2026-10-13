/**
 * Shaka Custom Player Controller
 * Inspired by reference design with embedded Title, Episode, Red Timeline,
 * 3-dots resolution settings, and keybinds (including 'F' for fullscreen).
 */

class ShakaCustomPlayer {
  constructor() {
    this.container = document.getElementById('playerContainer');
    this.video = document.getElementById('videoElement');
    this.overlay = document.getElementById('playerOverlay');
    this.spinner = document.getElementById('bufferingSpinner');
    this.toast = document.getElementById('playerToast');

    // Controls
    this.playPauseBtn = document.getElementById('playPauseBtn');
    this.playIcon = document.getElementById('playIcon');
    this.pauseIcon = document.getElementById('pauseIcon');
    
    this.progressContainer = document.getElementById('progressContainer');
    this.progressPlayed = document.getElementById('progressPlayed');
    this.progressBuffered = document.getElementById('progressBuffered');
    this.timeTooltip = document.getElementById('timeTooltip');
    this.timeDisplay = document.getElementById('timeDisplay');

    this.muteBtn = document.getElementById('muteBtn');
    this.volumeSlider = document.getElementById('volumeSlider');
    this.volumeIconHigh = document.getElementById('volumeIconHigh');
    this.volumeIconMuted = document.getElementById('volumeIconMuted');

    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.fullscreenIconEnter = document.getElementById('fullscreenIconEnter');
    this.fullscreenIconExit = document.getElementById('fullscreenIconExit');

    // Meta elements
    this.titleEl = document.getElementById('playerTitle');
    this.episodeEl = document.getElementById('playerEpisode');

    // Settings
    this.settingsBtn = document.getElementById('settingsBtn');
    this.settingsMenu = document.getElementById('settingsMenu');
    this.settingsCloseBtn = document.getElementById('settingsCloseBtn');
    this.qualityList = document.getElementById('qualityList');
    this.speedList = document.getElementById('speedList');

    // TMDB Connector Elements
    this.defaultTmdbApiKey = 'd4867796b2a15337894d2b42fa582ddb';
    this.tmdbIdInput = document.getElementById('tmdbIdInput');
    this.tmdbSeasonInput = document.getElementById('tmdbSeasonInput');
    this.tmdbEpisodeInput = document.getElementById('tmdbEpisodeInput');
    this.tmdbApplyBtn = document.getElementById('tmdbApplyBtn');
    this.tmdbPresetAos = document.getElementById('tmdbPresetAos');
    this.tmdbPresetMoving = document.getElementById('tmdbPresetMoving');

    this.player = null;
    this.isDragging = false;
    this.hideControlsTimer = null;
    this.toastTimer = null;
    this.activeTracks = [];

    this.init();
  }

  async init() {
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      alert('Browser tidak mendukung Shaka Player!');
      return;
    }

    this.player = new shaka.Player();
    await this.player.attach(this.video);

    // Listen for player errors
    this.player.addEventListener('error', (event) => this.onError(event.detail));

    // Bind event listeners
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.setupSettingsMenu();
    this.parseQueryParams();

    // Load initial stream (Can be modified or queried from URL)
    const initialStream = this.streamUri || 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';
    this.loadStream(initialStream);
  }

  setupEventListeners() {
    // Play / Pause
    this.playPauseBtn.addEventListener('click', () => this.togglePlay());
    this.video.addEventListener('click', () => this.togglePlay());

    this.video.addEventListener('play', () => this.updatePlayState(true));
    this.video.addEventListener('pause', () => this.updatePlayState(false));
    this.video.addEventListener('waiting', () => { this.spinner.style.display = 'block'; });
    this.video.addEventListener('playing', () => { this.spinner.style.display = 'none'; });

    // Time & Progress Updates (Red timeline)
    this.video.addEventListener('timeupdate', () => this.updateProgress());
    this.video.addEventListener('progress', () => this.updateBuffer());

    // Seeking / Scrubbing
    this.progressContainer.addEventListener('mousedown', (e) => this.startSeek(e));
    window.addEventListener('mousemove', (e) => this.handleSeekDrag(e));
    window.addEventListener('mouseup', () => this.endSeek());

    this.progressContainer.addEventListener('mousemove', (e) => this.showTooltip(e));
    this.progressContainer.addEventListener('mouseleave', () => {
      this.timeTooltip.style.display = 'none';
    });

    // Volume
    this.muteBtn.addEventListener('click', () => this.toggleMute());
    this.volumeSlider.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value));
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());

    // Auto-hide controls on inactivity
    this.container.addEventListener('mousemove', () => this.wakeControls());
    this.container.addEventListener('touchstart', () => this.wakeControls(), { passive: true });
    this.wakeControls();

    // Track changes (update resolution options)
    this.player.addEventListener('adaptation', () => this.refreshQualityList());
    this.player.addEventListener('variantchanged', () => this.refreshQualityList());
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't intercept if user is typing in an input field
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const key = e.key.toLowerCase();

      // Keybind 'f' or 'F' for Fullscreen (As requested!)
      if (key === 'f') {
        e.preventDefault();
        this.toggleFullscreen();
        this.showToast(document.fullscreenElement ? 'Fullscreen Aktif' : 'Keluar Fullscreen');
      }

      // Space or 'k' for Play / Pause
      else if (e.code === 'Space' || key === 'k') {
        e.preventDefault();
        this.togglePlay();
      }

      // Left Arrow or 'j' to Rewind 10s
      else if (e.code === 'ArrowLeft' || key === 'j') {
        e.preventDefault();
        this.video.currentTime = Math.max(0, this.video.currentTime - 10);
        this.showToast('⏪ -10s');
        this.wakeControls();
      }

      // Right Arrow or 'l' to Forward 10s
      else if (e.code === 'ArrowRight' || key === 'l') {
        e.preventDefault();
        this.video.currentTime = Math.min(this.video.duration || 0, this.video.currentTime + 10);
        this.showToast('⏩ +10s');
        this.wakeControls();
      }

      // Up Arrow: Volume Up
      else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.setVolume(Math.min(1, this.video.volume + 0.1));
        this.showToast(`🔊 Volume ${Math.round(this.video.volume * 100)}%`);
        this.wakeControls();
      }

      // Down Arrow: Volume Down
      else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.setVolume(Math.max(0, this.video.volume - 0.1));
        this.showToast(`🔉 Volume ${Math.round(this.video.volume * 100)}%`);
        this.wakeControls();
      }

      // 'm': Mute toggle
      else if (key === 'm') {
        e.preventDefault();
        this.toggleMute();
        this.showToast(this.video.muted ? '🔇 Muted' : '🔊 Unmuted');
        this.wakeControls();
      }
    });
  }

  setupSettingsMenu() {
    // Toggle 3-dots menu
    this.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = this.settingsMenu.classList.contains('active');
      if (isActive) {
        this.closeSettings();
      } else {
        this.openSettings();
      }
    });

    this.settingsCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSettings();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.settingsMenu.contains(e.target) && e.target !== this.settingsBtn) {
        this.closeSettings();
      }
    });

    // Playback Speed options
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    this.speedList.innerHTML = '';
    speeds.forEach((speed) => {
      const li = document.createElement('li');
      li.className = `settings-item ${speed === 1 ? 'active' : ''}`;
      li.innerHTML = `<span>${speed === 1 ? 'Normal' : speed + 'x'}</span>`;
      li.addEventListener('click', () => {
        this.video.playbackRate = speed;
        Array.from(this.speedList.children).forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        this.showToast(`Kecepatan: ${speed}x`);
        this.closeSettings();
      });
      this.speedList.appendChild(li);
    });

    // TMDB Apply button
    if (this.tmdbApplyBtn) {
      this.tmdbApplyBtn.addEventListener('click', () => {
        const id = this.tmdbIdInput.value.trim();
        const season = this.tmdbSeasonInput.value.trim();
        const ep = this.tmdbEpisodeInput.value.trim();
        if (!id) {
          this.showToast('Masukkan ID TMDB terlebih dahulu');
          return;
        }
        this.connectTMDB({
          id: id,
          season: season ? parseInt(season, 10) : undefined,
          episode: ep ? parseInt(ep, 10) : undefined
        });
        this.closeSettings();
      });
    }

    // TMDB Quick Presets
    if (this.tmdbPresetAos) {
      this.tmdbPresetAos.addEventListener('click', () => {
        this.tmdbIdInput.value = '135157';
        this.tmdbSeasonInput.value = '1';
        this.tmdbEpisodeInput.value = '1';
        this.connectTMDB({ id: 135157, season: 1, episode: 1 });
        this.closeSettings();
      });
    }

    if (this.tmdbPresetMoving) {
      this.tmdbPresetMoving.addEventListener('click', () => {
        this.tmdbIdInput.value = '126485';
        this.tmdbSeasonInput.value = '1';
        this.tmdbEpisodeInput.value = '1';
        this.connectTMDB({ id: 126485, season: 1, episode: 1 });
        this.closeSettings();
      });
    }
  }

  openSettings() {
    this.refreshQualityList();
    this.settingsMenu.classList.add('active');
  }

  closeSettings() {
    this.settingsMenu.classList.remove('active');
  }

  refreshQualityList() {
    if (!this.player) return;

    const tracks = this.player.getVariantTracks();
    const config = this.player.getConfiguration();
    const isAuto = config.abr.enabled;

    // Filter tracks with unique height resolutions
    const distinctResolutions = new Map();
    tracks.forEach((track) => {
      if (track.height && !distinctResolutions.has(track.height)) {
        distinctResolutions.set(track.height, track);
      }
    });

    const sortedTracks = Array.from(distinctResolutions.values()).sort((a, b) => b.height - a.height);

    this.qualityList.innerHTML = '';

    // Auto option
    const autoLi = document.createElement('li');
    autoLi.className = `settings-item ${isAuto ? 'active' : ''}`;
    autoLi.innerHTML = `<span>Otomatis (ABR)</span><span class="badge">Auto</span>`;
    autoLi.addEventListener('click', () => {
      this.player.configure({ abr: { enabled: true } });
      this.showToast('Kualitas: Otomatis (Adaptif)');
      this.refreshQualityList();
      this.closeSettings();
    });
    this.qualityList.appendChild(autoLi);

    // List specific resolutions (e.g. 1080p, 720p, 480p)
    sortedTracks.forEach((track) => {
      const isCurrent = !isAuto && track.active;
      const li = document.createElement('li');
      li.className = `settings-item ${isCurrent ? 'active' : ''}`;
      const bitrateKbps = Math.round(track.bandwidth / 1000);
      li.innerHTML = `<span>${track.height}p</span><span class="badge">${bitrateKbps} kbps</span>`;

      li.addEventListener('click', () => {
        this.player.configure({ abr: { enabled: false } });
        this.player.selectVariantTrack(track, /* clearBuffer= */ false);
        this.showToast(`Resolusi diubah ke: ${track.height}p`);
        this.refreshQualityList();
        this.closeSettings();
      });

      this.qualityList.appendChild(li);
    });
  }

  async loadStream(manifestUri) {
    this.spinner.style.display = 'block';
    try {
      await this.player.load(manifestUri);
      this.spinner.style.display = 'none';
      this.refreshQualityList();
    } catch (err) {
      this.spinner.style.display = 'none';
      this.onError(err);
    }
  }

  togglePlay() {
    if (this.video.paused) {
      this.video.play().catch(e => console.log('Autoplay policy error:', e));
    } else {
      this.video.pause();
    }
    this.wakeControls();
  }

  updatePlayState(isPlaying) {
    if (isPlaying) {
      this.playIcon.style.display = 'none';
      this.pauseIcon.style.display = 'block';
    } else {
      this.playIcon.style.display = 'block';
      this.pauseIcon.style.display = 'none';
      this.overlay.classList.remove('inactive');
    }
  }

  updateProgress() {
    if (this.isDragging) return;
    const current = this.video.currentTime;
    const duration = this.video.duration || 0;
    const percent = duration > 0 ? (current / duration) * 100 : 0;

    // Update the RED progress bar width
    this.progressPlayed.style.width = `${percent}%`;

    // Time text
    this.timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
  }

  updateBuffer() {
    if (!this.video.buffered.length || !this.video.duration) return;
    const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
    const duration = this.video.duration;
    const percent = (bufferedEnd / duration) * 100;
    this.progressBuffered.style.width = `${percent}%`;
  }

  startSeek(e) {
    this.isDragging = true;
    this.handleSeekDrag(e);
  }

  handleSeekDrag(e) {
    if (!this.isDragging) return;
    const rect = this.progressContainer.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.progressPlayed.style.width = `${pos * 100}%`;

    const targetTime = pos * (this.video.duration || 0);
    this.video.currentTime = targetTime;
  }

  endSeek() {
    if (this.isDragging) {
      this.isDragging = false;
      this.wakeControls();
    }
  }

  showTooltip(e) {
    const rect = this.progressContainer.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const hoverTime = pos * (this.video.duration || 0);

    this.timeTooltip.style.display = 'block';
    this.timeTooltip.style.left = `${pos * 100}%`;
    this.timeTooltip.textContent = this.formatTime(hoverTime);
  }

  setVolume(val) {
    this.video.volume = val;
    this.volumeSlider.value = val;
    if (val === 0) {
      this.video.muted = true;
      this.volumeIconHigh.style.display = 'none';
      this.volumeIconMuted.style.display = 'block';
    } else {
      this.video.muted = false;
      this.volumeIconHigh.style.display = 'block';
      this.volumeIconMuted.style.display = 'none';
    }
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    if (this.video.muted) {
      this.volumeIconHigh.style.display = 'none';
      this.volumeIconMuted.style.display = 'block';
    } else {
      this.volumeIconHigh.style.display = 'block';
      this.volumeIconMuted.style.display = 'none';
      if (this.video.volume === 0) {
        this.setVolume(0.5);
      }
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (this.container.requestFullscreen) {
        this.container.requestFullscreen();
      } else if (this.container.webkitRequestFullscreen) {
        this.container.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  onFullscreenChange() {
    const isFS = !!document.fullscreenElement;
    if (isFS) {
      this.fullscreenIconEnter.style.display = 'none';
      this.fullscreenIconExit.style.display = 'block';
    } else {
      this.fullscreenIconEnter.style.display = 'block';
      this.fullscreenIconExit.style.display = 'none';
    }
  }

  wakeControls() {
    this.overlay.classList.remove('inactive');
    this.container.classList.remove('inactive-cursor');

    clearTimeout(this.hideControlsTimer);
    if (!this.video.paused && !this.settingsMenu.classList.contains('active')) {
      this.hideControlsTimer = setTimeout(() => {
        if (!this.video.paused && !this.isDragging && !this.settingsMenu.classList.contains('active')) {
          this.overlay.classList.add('inactive');
          this.container.classList.add('inactive-cursor');
        }
      }, 3500);
    }
  }

  showToast(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove('show');
    }, 2200);
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);

    const pad = (n) => (n < 10 ? '0' + n : n);

    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  onError(error) {
    console.error('Shaka Player error:', error);
    this.showToast(`Error: ${error.message || error.code || 'Gagal memutar video'}`);
  }

  /**
   * Helper untuk mengeset info judul dan episode di dalam player
   * @param {Object} metadata
   * @param {string} metadata.title - Judul film / series
   * @param {number|string} metadata.season - Nomor season (opsional)
   * @param {number|string} metadata.episode - Nomor episode (opsional)
   */
  setMetadata({ title, season, episode }) {
    if (title) this.titleEl.textContent = title;
    if (season !== undefined && episode !== undefined) {
      this.episodeEl.textContent = `Eps ${episode} Season ${season}`;
      this.episodeEl.style.display = 'block';
    } else if (episode !== undefined) {
      this.episodeEl.textContent = `Episode ${episode}`;
      this.episodeEl.style.display = 'block';
    } else {
      this.episodeEl.style.display = 'none';
    }
  }

  /**
   * TMDB API Connector
   * Mudah dihubungkan dengan API TMDB untuk mengambil Judul dan Episode otomatis
   * @param {Object} params
   * @param {string} params.apiKey - TMDB v3 API Key
   * @param {number|string} params.id - TMDB Show ID
   * @param {number|string} params.season - Season number
   * @param {number|string} params.episode - Episode number
   */
  async connectTMDB({ apiKey, id, season, episode, type }) {
    const key = apiKey || this.defaultTmdbApiKey;
    if (!key || !id) {
      console.warn('TMDB: apiKey and id are required');
      return;
    }

    try {
      this.showToast('Menghubungkan ke TMDB...');

      if (type === 'movie' || (season === undefined && episode === undefined)) {
        // Mode Movie
        const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${key}&language=id-ID`);
        const movieData = await movieRes.json();
        const movieTitle = movieData.title || movieData.original_title || 'Movie';
        
        this.setMetadata({
          title: movieTitle,
        });

        if (movieData.backdrop_path) {
          this.video.poster = `https://image.tmdb.org/t/p/original${movieData.backdrop_path}`;
        }
        this.showToast(`TMDB: ${movieTitle}`);
      } else {
        // Mode Series / TV
        const seriesRes = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${key}&language=id-ID`);
        const seriesData = await seriesRes.json();
        const seriesName = seriesData.name || seriesData.original_name || 'Series';

        if (season !== undefined && episode !== undefined) {
          const epRes = await fetch(`https://api.themoviedb.org/3/tv/${id}/season/${season}/episode/${episode}?api_key=${key}&language=id-ID`);
          const epData = await epRes.json();
          
          const epName = epData.name && !epData.name.startsWith('Episode') ? ` - ${epData.name}` : '';
          const fullTitle = `${seriesName}${epName}`;

          this.setMetadata({
            title: fullTitle,
            season: season,
            episode: episode
          });

          if (epData.still_path) {
            this.video.poster = `https://image.tmdb.org/t/p/original${epData.still_path}`;
          } else if (seriesData.backdrop_path) {
            this.video.poster = `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}`;
          }

          this.showToast(`TMDB: ${seriesName} (S${season} E${episode})`);
        } else {
          this.setMetadata({
            title: seriesName,
          });
          if (seriesData.backdrop_path) {
            this.video.poster = `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}`;
          }
          this.showToast(`TMDB: ${seriesName}`);
        }
      }
    } catch (err) {
      console.error('TMDB Error:', err);
      this.showToast('Gagal mengambil data dari TMDB');
    }
  }

  parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const title = params.get('title');
    const season = params.get('season');
    const episode = params.get('episode');
    const tmdbKey = params.get('tmdb_key');
    const tmdbId = params.get('tmdb_id');
    const tmdbMovie = params.get('tmdb_movie');

    if (src) this.streamUri = src;

    if (title) {
      this.setMetadata({
        title: title,
        season: season || undefined,
        episode: episode || undefined
      });
    }

    if (tmdbMovie) {
      this.connectTMDB({
        apiKey: tmdbKey,
        id: tmdbMovie,
        type: 'movie'
      });
    } else if (tmdbId) {
      this.connectTMDB({
        apiKey: tmdbKey,
        id: tmdbId,
        season: season ? parseInt(season, 10) : 1,
        episode: episode ? parseInt(episode, 10) : 1
      });
    }
  }
}

// Global instance exposed for easy connection
document.addEventListener('DOMContentLoaded', () => {
  window.customPlayer = new ShakaCustomPlayer();
});
