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
    this.audioList = document.getElementById('audioList');
    this.subtitleList = document.getElementById('subtitleList');
    this.speedList = document.getElementById('speedList');
    this.subFileInput = document.getElementById('subFileInput');
    this.videoFileInput = document.getElementById('videoFileInput');

    // Audio Language Selection State
    this.manualAudioLanguage = null;
    this.isManualAudioSelected = false;
    this.isSelectingAudio = false;
    this.isSwitchingAudio = false;

    // Subtitle / Teks State
    this.isSubtitleActive = false;
    this.currentTextTrack = null;
    this.subUri = null;

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

    // Konfigurasi prioritas audio: Bahasa Indonesia ('id') -> Bahasa Inggris ('en')
    this.player.configure({
      preferredAudio: [
        { language: 'id' },
        { language: 'en' }
      ]
    });

    // Listen for player errors
    this.player.addEventListener('error', (event) => this.onError(event.detail));

    // Bind event listeners
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.setupSettingsMenu();
    this.parseQueryParams();

    // Load initial stream (Can be modified, local video file, or queried from URL)
    let initialStream = this.streamUri;
    if (!initialStream) {
      try {
        const vCheck = await fetch('alchemy_of_souls_s01e01.mp4', { method: 'HEAD' });
        if (vCheck.ok) {
          initialStream = 'alchemy_of_souls_s01e01.mp4';
        }
      } catch (e) {}
    }
    if (!initialStream) {
      initialStream = 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';
    }
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

    // Track changes (update resolution & audio options)
    this.player.addEventListener('adaptation', () => {
      this.refreshQualityList();
      this.refreshAudioList();
    });
    this.player.addEventListener('variantchanged', () => {
      this.refreshQualityList();
      this.refreshAudioList();
    });
    this.player.addEventListener('audiotrackschanged', () => {
      this.refreshAudioList();
    });
    this.player.addEventListener('trackschanged', () => {
      this.applyAudioSelection();
      this.refreshQualityList();
      this.refreshAudioList();
      this.refreshSubtitleList();
    });
    this.player.addEventListener('texttrackschanged', () => {
      this.refreshSubtitleList();
    });
    this.player.addEventListener('textchanged', () => {
      this.refreshSubtitleList();
    });

    // File input listener for external subtitles
    if (this.subFileInput) {
      this.subFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          this.loadSubtitleFromFile(file);
          this.subFileInput.value = '';
        }
      });
    }

    // File input listener for local videos
    if (this.videoFileInput) {
      this.videoFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          this.loadVideoFromFile(file);
          this.videoFileInput.value = '';
        }
      });
    }

    // Drag & Drop external subtitle (.srt / .vtt) and video (.mp4 / .webm / .mkv) into player
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.container.classList.add('dragover');
    });
    this.container.addEventListener('dragleave', () => {
      this.container.classList.remove('dragover');
    });
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.container.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        const files = Array.from(e.dataTransfer.files);
        const videoFile = files.find((f) => /\.(mp4|webm|mkv|mov|m4v)$/i.test(f.name));
        const subFile = files.find((f) => /\.(srt|vtt)$/i.test(f.name));

        if (videoFile) {
          this.loadVideoFromFile(videoFile);
        }
        if (subFile) {
          this.loadSubtitleFromFile(subFile);
        }
        if (!videoFile && !subFile) {
          this.showToast('Format file tidak didukung (.mp4, .mkv, .srt, .vtt)');
        }
      }
    });
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

      // 'c': Subtitle toggle
      else if (key === 'c') {
        e.preventDefault();
        this.toggleSubtitle();
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

    // Local Video Picker Button in Settings
    const btnPickLocalVideo = document.getElementById('btnPickLocalVideo');
    if (btnPickLocalVideo) {
      btnPickLocalVideo.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.videoFileInput) {
          this.videoFileInput.click();
        }
        this.closeSettings();
      });
    }
  }

  openSettings() {
    this.refreshQualityList();
    this.refreshAudioList();
    this.refreshSubtitleList();
    this.settingsMenu.classList.add('active');
  }

  closeSettings() {
    this.settingsMenu.classList.remove('active');
  }

  /**
   * Normalisasi bahasa menggunakan Shaka LanguageUtils atau fallback aman
   * @param {string} lang
   * @return {string}
   */
  normalizeLanguage(lang) {
    if (!lang || typeof lang !== 'string') return '';
    try {
      if (typeof shaka !== 'undefined' && shaka.util && shaka.util.LanguageUtils) {
        return shaka.util.LanguageUtils.normalize(lang);
      }
    } catch (e) {}
    const cleaned = lang.trim().toLowerCase().replace('_', '-');
    const parts = cleaned.split('-');
    const langCode = parts[0];
    const region = parts[1] ? parts[1].toUpperCase() : '';
    let mapped = langCode;
    if (langCode === 'ind' || langCode === 'in') mapped = 'id';
    else if (langCode === 'eng') mapped = 'en';
    else if (langCode === 'ita') mapped = 'it';
    return region ? `${mapped}-${region}` : mapped;
  }

  /**
   * Mengambil kode bahasa dasar 2-huruf (misal: 'id-ID' -> 'id', 'en-US' -> 'en')
   * @param {string} lang
   * @return {string}
   */
  getBaseLanguage(lang) {
    const norm = this.normalizeLanguage(lang);
    if (!norm) return '';
    try {
      if (typeof shaka !== 'undefined' && shaka.util && shaka.util.LanguageUtils) {
        return shaka.util.LanguageUtils.getBase(norm);
      }
    } catch (e) {}
    return norm.split('-')[0].toLowerCase();
  }

  /**
   * Mencari track audio yang cocok berdasarkan kode bahasa
   * Mendukung pencocokan variasi regional ('id-ID' -> 'id', 'en-US' -> 'en')
   * @param {!Array<shaka.extern.AudioTrack>} tracks
   * @param {string} targetLang
   * @return {?shaka.extern.AudioTrack}
   */
  findMatchingAudioTrack(tracks, targetLang) {
    if (!tracks || !tracks.length || !targetLang) return null;
    const targetNorm = this.normalizeLanguage(targetLang);
    const targetBase = this.getBaseLanguage(targetLang);

    // Filter semua kandidat yang cocok secara normalized maupun base language
    const candidates = tracks.filter((t) => {
      const l = this.normalizeLanguage(t.language || t.originalLanguage);
      const b = this.getBaseLanguage(t.language || t.originalLanguage);
      return (l && l.toLowerCase() === targetNorm.toLowerCase()) || (b && b === targetBase);
    });

    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    // Jika ada kandidat yang sedang aktif, pertahankan
    const activeCandidate = candidates.find((t) => t.active);
    if (activeCandidate) return activeCandidate;

    // Jika ada beberapa kandidat (misal AAC dan Opus), utamakan yang cocok dengan mimeType/codec track aktif
    const activeTrack = tracks.find((t) => t.active);
    if (activeTrack) {
      if (activeTrack.mimeType) {
        const mimeMatch = candidates.find((t) => t.mimeType === activeTrack.mimeType);
        if (mimeMatch) return mimeMatch;
      }
      if (activeTrack.codecs) {
        const codecMatch = candidates.find((t) => t.codecs === activeTrack.codecs);
        if (codecMatch) return codecMatch;
      }
    }

    return candidates[0];
  }

  /**
   * Menerapkan aturan seleksi audio:
   * 1. Jika ada pilihan manual dari pengguna dan track masih tersedia -> pertahankan.
   * 2. Prioritas 1: Bahasa Indonesia ('id', 'id-ID', 'ind', dll).
   * 3. Prioritas 2: Bahasa Inggris ('en', 'en-US', 'eng', dll).
   * 4. Prioritas 3: Pilihan default provider (primary track atau track aktif).
   */
  applyAudioSelection() {
    if (!this.player || this.isSelectingAudio) return;
    this.isSelectingAudio = true;

    try {
      const tracks = this.player.getAudioTracks();
      if (!tracks || !tracks.length) return;

      const activeTrack = tracks.find((t) => t.active);

      // 1. Pertahankan pilihan manual pengguna jika masih tersedia di manifest
      if (this.isManualAudioSelected && this.manualAudioLanguage) {
        // Jika track aktif saat ini SUDAH cocok dengan bahasa pilihan pengguna, tidak perlu switch ulang
        if (activeTrack && this.getBaseLanguage(activeTrack.language || activeTrack.originalLanguage) === this.getBaseLanguage(this.manualAudioLanguage)) {
          return;
        }

        const manualTrack = this.findMatchingAudioTrack(tracks, this.manualAudioLanguage);
        if (manualTrack) {
          if (!manualTrack.active) {
            this.player.selectAudioTrack(manualTrack, /* safeMargin= */ 0);
          }
          return;
        }
        // Jika track pilihan manual sudah tidak ada di manifest baru, fallback ke auto
      }

      // 2. Prioritas 1: Bahasa Indonesia
      const idTrack = this.findMatchingAudioTrack(tracks, 'id');
      if (idTrack) {
        if (!idTrack.active) {
          this.player.selectAudioTrack(idTrack, /* safeMargin= */ 0);
        }
        return;
      }

      // 3. Prioritas 2: Bahasa Inggris
      const enTrack = this.findMatchingAudioTrack(tracks, 'en');
      if (enTrack) {
        if (!enTrack.active) {
          this.player.selectAudioTrack(enTrack, /* safeMargin= */ 0);
        }
        return;
      }

      // 4. Prioritas 3: Default provider (track dengan primary: true atau aktif)
      const primaryTrack = tracks.find((t) => t.primary);
      if (primaryTrack && !primaryTrack.active && !activeTrack) {
        this.player.selectAudioTrack(primaryTrack, /* safeMargin= */ 0);
      }
    } catch (err) {
      console.warn('Error saat auto-seleksi audio track:', err);
    } finally {
      this.isSelectingAudio = false;
    }
  }

  /**
   * Menghasilkan label teks ramah untuk track audio
   * @param {shaka.extern.AudioTrack} track
   * @return {string}
   */
  getAudioTrackDisplayLabel(track) {
    const langNames = {
      'id': 'Indonesia',
      'in': 'Indonesia',
      'en': 'English',
      'it': 'Italiano',
      'es': 'Español',
      'ja': '日本語 (Japanese)',
      'ko': '한국어 (Korean)',
      'fr': 'Français',
      'de': 'Deutsch',
      'zh': '中文 (Chinese)',
      'pt': 'Português',
      'ru': 'Русский',
      'ar': 'العربية',
      'el': 'Ελληνικά (Greek)'
    };

    const base = this.getBaseLanguage(track.language || track.originalLanguage);
    let name = langNames[base] || track.label || track.language || 'Audio';

    if (track.label && track.label !== name && !track.label.toLowerCase().includes(name.toLowerCase())) {
      name = `${name} (${track.label})`;
    } else if (track.language && track.language !== base) {
      name = `${name} [${track.language}]`;
    }

    return name;
  }

  /**
   * Mengembalikan daftar track audio unik untuk ditampilkan pada UI (mencegah duplikasi codec/variant)
   * @return {!Array<shaka.extern.AudioTrack>}
   */
  getDistinctAudioTracks() {
    if (!this.player) return [];
    const tracks = this.player.getAudioTracks() || [];
    if (!tracks.length) return [];

    const activeTrack = tracks.find((t) => t.active);
    const distinct = new Map();

    for (const track of tracks) {
      const baseLang = this.getBaseLanguage(track.language || track.originalLanguage);
      const specialRoles = (track.roles || []).filter(r => r !== 'main' && r !== 'alternate');
      const roleStr = specialRoles.join(',');
      const channels = track.channelsCount || 2;
      const userKey = `${baseLang}_${roleStr}_${channels > 2 ? channels : 'stereo'}`;

      if (!distinct.has(userKey)) {
        distinct.set(userKey, track);
      } else {
        if (track.active) {
          distinct.set(userKey, track);
        } else {
          const existing = distinct.get(userKey);
          if (!existing.active && activeTrack && track.mimeType === activeTrack.mimeType) {
            distinct.set(userKey, track);
          }
        }
      }
    }

    return Array.from(distinct.values());
  }

  /**
   * Mengganti track audio secara live ketika pengguna memilih dari menu tanpa refresh halaman
   * @param {shaka.extern.AudioTrack} track
   */
  async selectAudioManually(track) {
    if (!this.player || this.isSwitchingAudio) return;
    if (!track) return;

    this.isSwitchingAudio = true;
    try {
      const currentTracks = this.player.getAudioTracks() || [];
      // Cari track terbaik yang cocok dari daftar track saat ini
      let targetTrack = currentTracks.find((t) => {
        if (track.id != null && t.id != null) return t.id === track.id;
        return this.getBaseLanguage(t.language) === this.getBaseLanguage(track.language) &&
               t.channelsCount === track.channelsCount &&
               t.mimeType === track.mimeType;
      });

      if (!targetTrack) {
        targetTrack = this.findMatchingAudioTrack(currentTracks, track.language || track.originalLanguage);
      }

      if (!targetTrack) {
        this.showToast('Track audio tidak tersedia');
        this.refreshAudioList();
        return;
      }

      // 1. Tandai pilihan manual pengguna agar tidak ditimpa oleh auto-selector
      this.isManualAudioSelected = true;
      this.manualAudioLanguage = targetTrack.language || targetTrack.originalLanguage;

      // 2. Terapkan pemilihan audio via Shaka Player API seketika (safeMargin: 0)
      this.player.selectAudioTrack(targetTrack, /* safeMargin= */ 0);

      // 3. Kunci konfigurasi preferredAudio player agar ABR engine internal Shaka tetap mengunci pilihan ini
      this.player.configure({
        preferredAudio: [{
          language: targetTrack.language,
          role: (targetTrack.roles && targetTrack.roles[0]) || '',
          label: targetTrack.label || '',
          channelCount: targetTrack.channelsCount || 0,
          codec: '',
          spatialAudio: targetTrack.spatialAudio || false
        }]
      });

      const label = this.getAudioTrackDisplayLabel(targetTrack);
      this.showToast(`Audio: ${label}`);

      // 4. Segera perbarui indikator track aktif pada UI
      this.refreshAudioList();
      this.closeSettings();
    } catch (err) {
      console.error('Gagal menerapkan pilihan audio secara live:', err);
      this.showToast('Gagal mengganti bahasa audio');
      this.refreshAudioList();
    } finally {
      this.isSwitchingAudio = false;
    }
  }

  /**
   * Memperbarui daftar pilihan audio di menu settings titik-3
   */
  refreshAudioList() {
    if (!this.player || !this.audioList) return;
    const distinctTracks = this.getDistinctAudioTracks();
    this.audioList.innerHTML = '';

    if (!distinctTracks || !distinctTracks.length) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'settings-item';
      emptyLi.style.cursor = 'default';
      emptyLi.style.opacity = '0.6';
      emptyLi.innerHTML = `<span>Tidak ada pilihan audio</span>`;
      this.audioList.appendChild(emptyLi);
      return;
    }

    const allTracks = this.player.getAudioTracks() || [];
    const activeTrack = allTracks.find((t) => t.active);

    distinctTracks.forEach((track) => {
      const isActive = activeTrack && (
        (track.id != null && activeTrack.id != null && track.id === activeTrack.id) ||
        (this.getBaseLanguage(track.language) === this.getBaseLanguage(activeTrack.language) &&
         track.channelsCount === activeTrack.channelsCount)
      );

      const li = document.createElement('li');
      li.className = `settings-item ${isActive ? 'active' : ''}`;

      const label = this.getAudioTrackDisplayLabel(track);
      let badge = '';
      if (isActive) {
        badge = '<span class="badge" style="background:#e50914;color:#fff;">Aktif</span>';
      } else if (track.channelsCount && track.channelsCount > 2) {
        badge = `<span class="badge">${track.channelsCount}.1</span>`;
      }

      li.innerHTML = `<span>${label}</span>${badge}`;

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectAudioManually(track);
      });

      this.audioList.appendChild(li);
    });
  }

  refreshQualityList() {
    if (!this.player) return;

    const tracks = this.player.getVariantTracks();
    const config = this.player.getConfiguration();
    const isAuto = config.abr.enabled;

    // Filter tracks dengan tinggi resolusi unik
    const distinctResolutions = new Map();
    tracks.forEach((track) => {
      if (track.height && !distinctResolutions.has(track.height)) {
        distinctResolutions.set(track.height, track);
      }
    });

    const sortedTracks = Array.from(distinctResolutions.values()).sort((a, b) => b.height - a.height);

    this.qualityList.innerHTML = '';

    // Opsi Otomatis (ABR)
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

    // Daftar resolusi spesifik (1080p, 720p, 480p, dll.)
    sortedTracks.forEach((track) => {
      const isCurrent = !isAuto && track.active;
      const li = document.createElement('li');
      li.className = `settings-item ${isCurrent ? 'active' : ''}`;
      const bitrateKbps = Math.round(track.bandwidth / 1000);
      li.innerHTML = `<span>${track.height}p</span><span class="badge">${bitrateKbps} kbps</span>`;

      li.addEventListener('click', () => {
        this.player.configure({ abr: { enabled: false } });

        // PENTING: Pilih variant pada resolusi ini yang mempertahankan audio aktif saat ini!
        const allVariants = this.player.getVariantTracks();
        const activeVariant = allVariants.find((v) => v.active);
        const candidates = allVariants.filter((v) => v.height === track.height);

        let chosenVariant = null;
        if (activeVariant) {
          // 1. Cocokkan audioId yang sama
          if (activeVariant.audioId != null) {
            chosenVariant = candidates.find((v) => v.audioId === activeVariant.audioId);
          }
          // 2. Cocokkan bahasa audio yang sama jika audioId tidak match
          if (!chosenVariant && activeVariant.language) {
            const activeLang = this.getBaseLanguage(activeVariant.language);
            chosenVariant = candidates.find((v) => this.getBaseLanguage(v.language) === activeLang);
          }
        }

        // 3. Jika pengguna pernah memilih audio manual, sesuaikan dengan bahasa manual tersebut
        if (!chosenVariant && this.isManualAudioSelected && this.manualAudioLanguage) {
          const manualLang = this.getBaseLanguage(this.manualAudioLanguage);
          chosenVariant = candidates.find((v) => this.getBaseLanguage(v.language) === manualLang);
        }

        // Fallback ke candidate pertama jika tidak ada yang spesifik
        const finalVariant = chosenVariant || candidates[0] || track;

        this.player.selectVariantTrack(finalVariant, /* clearBuffer= */ false);
        this.showToast(`Resolusi diubah ke: ${track.height}p`);
        this.refreshQualityList();
        this.refreshAudioList();
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
      this.applyAudioSelection();
      this.refreshQualityList();
      this.refreshAudioList();
      await this.initSubtitles();
      this.refreshSubtitleList();
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
   * Inisialisasi subtitle saat stream selesai dimuat
   */
  async initSubtitles() {
    try {
      if (this.subUri) {
        await this.loadSubtitleFromUrl(this.subUri, 'Subtitle Eksternal', 'id');
        return;
      }

      // Coba muat subtitle default Alchemy of Souls (SRT atau VTT, relatif maupun absolut)
      const defaultCandidates = [
        'alchemy_of_souls_s01e01_id.srt',
        '/alchemy_of_souls_s01e01_id.srt',
        'alchemy_of_souls_s01e01_id.vtt',
        '/alchemy_of_souls_s01e01_id.vtt'
      ];

      for (const candidate of defaultCandidates) {
        try {
          const testRes = await fetch(candidate, { method: 'HEAD' });
          if (testRes.ok) {
            const track = await this.loadSubtitleFromUrl(
              candidate,
              'Indonesia (Alchemy of Souls S01E01)',
              'id'
            );
            if (track) return;
          }
        } catch (e) {
          // ignore & try next candidate
        }
      }

      // Fallback langsung muat relative srt jika fetch HEAD tidak didukung
      await this.loadSubtitleFromUrl(
        'alchemy_of_souls_s01e01_id.srt',
        'Indonesia (Alchemy of Souls S01E01)',
        'id'
      );
    } catch (err) {
      console.warn('Gagal menginisialisasi subtitle default:', err);
    }
  }

  /**
   * Muat subtitle dari URL / Path lokal
   * @param {string} url
   * @param {string} label
   * @param {string} language
   */
  async loadSubtitleFromUrl(url, label = 'Indonesia', language = 'id') {
    if (!this.player) return null;
    try {
      const isSrt = url.toLowerCase().includes('.srt');
      const mimeType = isSrt ? 'text/srt' : 'text/vtt';

      const track = await this.player.addTextTrackAsync(
        url,
        language,
        'subtitles',
        mimeType,
        undefined,
        label
      );

      this.player.selectTextTrack(track);
      this.currentTextTrack = track;
      this.isSubtitleActive = true;
      this.refreshSubtitleList();
      this.showToast(`💬 Subtitle: ${label}`);
      return track;
    } catch (err) {
      console.error('Error saat memuat subtitle:', err);
      this.showToast('Gagal memuat file subtitle');
      return null;
    }
  }

  /**
   * Muat subtitle dari File lokal (File picker atau Drag & Drop)
   * @param {File} file
   */
  async loadSubtitleFromFile(file) {
    if (!file) return null;
    try {
      const blobUrl = URL.createObjectURL(file);
      const cleanName = file.name.replace(/\.(srt|vtt)$/i, '');
      const label = `Kustom: ${cleanName}`;
      return await this.loadSubtitleFromUrl(blobUrl, label, 'id');
    } catch (err) {
      console.error('Error membaca file subtitle lokal:', err);
      this.showToast('Gagal membaca file subtitle lokal');
      return null;
    }
  }

  /**
   * Muat video dari file lokal pengguna (.mp4 / .webm / .mkv)
   * @param {File} file
   */
  async loadVideoFromFile(file) {
    if (!file || !this.player) return;
    try {
      this.spinner.style.display = 'block';
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      this.setMetadata({
        title: cleanName
      });

      const blobUrl = URL.createObjectURL(file);
      await this.player.load(blobUrl);
      this.spinner.style.display = 'none';

      this.applyAudioSelection();
      this.refreshQualityList();
      this.refreshAudioList();
      await this.initSubtitles();
      this.refreshSubtitleList();
      this.showToast(`🎬 Video dimuat: ${file.name}`);
      this.video.play().catch(() => {});
    } catch (err) {
      this.spinner.style.display = 'none';
      console.error('Error saat memuat file video lokal:', err);
      this.showToast('Gagal memuat file video lokal');
    }
  }

  /**
   * Toggle Subtitle ON / OFF (Shortcut 'C')
   */
  toggleSubtitle() {
    if (!this.player) return;
    const tracks = this.player.getTextTracks() || [];
    if (!tracks.length) {
      this.showToast('💬 Tidak ada subtitle tersedia');
      return;
    }

    if (this.isSubtitleActive) {
      this.player.selectTextTrack(null);
      this.isSubtitleActive = false;
      this.showToast('💬 Subtitle dinonaktifkan');
    } else {
      const trackToSelect = this.currentTextTrack || tracks[0];
      this.player.selectTextTrack(trackToSelect);
      this.currentTextTrack = trackToSelect;
      this.isSubtitleActive = true;
      this.showToast(`💬 Subtitle: ${trackToSelect.label || trackToSelect.language || 'Aktif'}`);
    }
    this.refreshSubtitleList();
  }

  /**
   * Render ulang daftar subtitle pada menu 3-titik
   */
  refreshSubtitleList() {
    if (!this.player || !this.subtitleList) return;
    const tracks = this.player.getTextTracks() || [];
    this.subtitleList.innerHTML = '';

    const activeTrack = tracks.find((t) => t.active);
    this.isSubtitleActive = !!activeTrack;
    if (activeTrack) {
      this.currentTextTrack = activeTrack;
    }

    // 1. Opsi "Nonaktif"
    const offLi = document.createElement('li');
    offLi.className = `settings-item ${!this.isSubtitleActive ? 'active' : ''}`;
    offLi.innerHTML = `<span>Nonaktif</span>${!this.isSubtitleActive ? '<span class="badge" style="background:#e50914;color:#fff;">Aktif</span>' : ''}`;
    offLi.addEventListener('click', (e) => {
      e.stopPropagation();
      this.player.selectTextTrack(null);
      this.isSubtitleActive = false;
      this.refreshSubtitleList();
      this.showToast('💬 Subtitle dinonaktifkan');
      this.closeSettings();
    });
    this.subtitleList.appendChild(offLi);

    // 2. Daftar text tracks yang tersedia
    tracks.forEach((track) => {
      const isActive = track.active;
      const li = document.createElement('li');
      li.className = `settings-item ${isActive ? 'active' : ''}`;

      let labelText = track.label || track.language;
      if (track.language && track.label && track.label !== track.language) {
        labelText = `${track.label} (${track.language})`;
      }
      if (!labelText) labelText = 'Subtitle';

      const badge = isActive ? '<span class="badge" style="background:#e50914;color:#fff;">Aktif</span>' : '';
      li.innerHTML = `<span>${labelText}</span>${badge}`;

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        this.player.selectTextTrack(track);
        this.currentTextTrack = track;
        this.isSubtitleActive = true;
        this.refreshSubtitleList();
        this.showToast(`💬 Subtitle: ${track.label || track.language}`);
        this.closeSettings();
      });

      this.subtitleList.appendChild(li);
    });

    // 3. Tombol "+ Muat File Subtitle (.srt / .vtt)"
    const uploadLi = document.createElement('li');
    uploadLi.className = 'settings-item';
    uploadLi.style.borderTop = '1px dashed rgba(255,255,255,0.15)';
    uploadLi.style.marginTop = '4px';
    uploadLi.style.color = '#38bdf8';
    uploadLi.innerHTML = `<span>+ Muat File Subtitle (.srt / .vtt)</span><span class="badge" style="background:rgba(56,189,248,0.2);color:#38bdf8;">File</span>`;
    uploadLi.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.subFileInput) {
        this.subFileInput.click();
      }
    });
    this.subtitleList.appendChild(uploadLi);
  }

  parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const title = params.get('title');
    const season = params.get('season');
    const episode = params.get('episode');
    const sub = params.get('sub');

    if (src) this.streamUri = src;
    if (sub) this.subUri = sub;

    if (title) {
      this.setMetadata({
        title: title,
        season: season || undefined,
        episode: episode || undefined
      });
    } else {
      this.setMetadata({
        title: 'Alchemy of Souls',
        season: 1,
        episode: 1
      });
    }
  }
}

// Global instance exposed for easy connection
document.addEventListener('DOMContentLoaded', () => {
  window.customPlayer = new ShakaCustomPlayer();
});
