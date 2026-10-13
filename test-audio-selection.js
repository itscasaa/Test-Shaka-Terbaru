/**
 * Comprehensive Audio Language Selection Test Suite for ShakaCustomPlayer
 * Testing all Phase 3 requirements.
 */

const assert = require('assert');

// Language Normalization and Selector logic (identical to player.js)
class AudioSelectorTester {
  constructor() {
    this.manualAudioLanguage = null;
    this.isManualAudioSelected = false;
    this.isSelectingAudio = false;
    this.selectedTrack = null;
    this.selectedVariant = null;
    this.abrConfig = { enabled: true };
    this.audioTracks = [];
    this.variantTracks = [];
  }

  normalizeLanguage(lang) {
    if (!lang || typeof lang !== 'string') return '';
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

  getBaseLanguage(lang) {
    const norm = this.normalizeLanguage(lang);
    if (!norm) return '';
    return norm.split('-')[0].toLowerCase();
  }

  findMatchingAudioTrack(tracks, targetLang) {
    if (!tracks || !tracks.length || !targetLang) return null;
    const targetNorm = this.normalizeLanguage(targetLang);
    const targetBase = this.getBaseLanguage(targetLang);

    // 1. Exact normalized match
    const exact = tracks.find((t) => {
      const l = this.normalizeLanguage(t.language || t.originalLanguage);
      return l && l.toLowerCase() === targetNorm.toLowerCase();
    });
    if (exact) return exact;

    // 2. Base language match
    const baseMatch = tracks.find((t) => {
      const b = this.getBaseLanguage(t.language || t.originalLanguage);
      return b && b === targetBase;
    });
    if (baseMatch) return baseMatch;

    return null;
  }

  applyAudioSelection() {
    if (this.isSelectingAudio) return;
    this.isSelectingAudio = true;

    try {
      const tracks = this.audioTracks;
      if (!tracks || !tracks.length) return;

      // 1. Manual user selection
      if (this.isManualAudioSelected && this.manualAudioLanguage) {
        const manualTrack = this.findMatchingAudioTrack(tracks, this.manualAudioLanguage);
        if (manualTrack) {
          if (!manualTrack.active) {
            this.selectAudioTrack(manualTrack);
          }
          return;
        }
      }

      const activeTrack = tracks.find((t) => t.active);

      // 2. Priority 1: Indonesian
      const idTrack = this.findMatchingAudioTrack(tracks, 'id');
      if (idTrack) {
        if (!idTrack.active) {
          this.selectAudioTrack(idTrack);
        }
        return;
      }

      // 3. Priority 2: English
      const enTrack = this.findMatchingAudioTrack(tracks, 'en');
      if (enTrack) {
        if (!enTrack.active) {
          this.selectAudioTrack(enTrack);
        }
        return;
      }

      // 4. Priority 3: Provider default (primary or active)
      const primaryTrack = tracks.find((t) => t.primary);
      if (primaryTrack && !primaryTrack.active && !activeTrack) {
        this.selectAudioTrack(primaryTrack);
      }
    } finally {
      this.isSelectingAudio = false;
    }
  }

  selectAudioTrack(track) {
    this.audioTracks.forEach(t => t.active = (t === track));
    this.selectedTrack = track;
  }

  selectResolution(targetHeight) {
    const allVariants = this.variantTracks;
    const activeVariant = allVariants.find((v) => v.active);
    const candidates = allVariants.filter((v) => v.height === targetHeight);

    let chosenVariant = null;
    if (activeVariant) {
      if (activeVariant.audioId != null) {
        chosenVariant = candidates.find((v) => v.audioId === activeVariant.audioId);
      }
      if (!chosenVariant && activeVariant.language) {
        const activeLang = this.getBaseLanguage(activeVariant.language);
        chosenVariant = candidates.find((v) => this.getBaseLanguage(v.language) === activeLang);
      }
    }

    if (!chosenVariant && this.isManualAudioSelected && this.manualAudioLanguage) {
      const manualLang = this.getBaseLanguage(this.manualAudioLanguage);
      chosenVariant = candidates.find((v) => this.getBaseLanguage(v.language) === manualLang);
    }

    const finalVariant = chosenVariant || candidates[0];
    if (finalVariant) {
      allVariants.forEach(v => v.active = (v === finalVariant));
      this.selectedVariant = finalVariant;
    }
  }
}

// -------------------------------------------------------------
// TEST CASES
// -------------------------------------------------------------
console.log('=== STARTING SHAKA PLAYER AUDIO SELECTION TESTS ===\n');

// Test 1: Track Indonesia tersedia bersama Italian dan English -> Pilih Indonesia
{
  const tester = new AudioSelectorTester();
  tester.audioTracks = [
    { language: 'it', active: true, primary: true },
    { language: 'en', active: false, primary: false },
    { language: 'id', active: false, primary: false },
  ];

  tester.applyAudioSelection();
  assert.strictEqual(tester.selectedTrack.language, 'id', 'Harus memilih track Indonesia saat tersedia bersama IT dan EN');
  console.log('✓ TEST 1 PASS: Track Indonesia dipilih ketika tersedia bersama Italian dan English');
}

// Test 2: Indonesia tidak tersedia tetapi English tersedia -> Pilih English
{
  const tester = new AudioSelectorTester();
  tester.audioTracks = [
    { language: 'it', active: true, primary: true },
    { language: 'en', active: false, primary: false },
    { language: 'de', active: false, primary: false },
  ];

  tester.applyAudioSelection();
  assert.strictEqual(tester.selectedTrack.language, 'en', 'Harus memilih track English saat ID tidak tersedia');
  console.log('✓ TEST 2 PASS: Track English dipilih ketika Indonesia tidak tersedia');
}

// Test 3: Indonesia dan English tidak tersedia -> Pertahankan default provider yang valid
{
  const tester = new AudioSelectorTester();
  tester.audioTracks = [
    { language: 'it', active: false, primary: false },
    { language: 'fr', active: false, primary: true },
    { language: 'de', active: false, primary: false },
  ];

  tester.applyAudioSelection();
  assert.strictEqual(tester.selectedTrack.language, 'fr', 'Harus memilih provider default (primary) saat ID dan EN absen');
  console.log('✓ TEST 3 PASS: Provider default (primary=true) dipertahankan saat ID dan EN tidak ada');
}

// Test 4: Variasi kode regional ('id-ID', 'en-US', 'en-GB', 'ind', 'eng')
{
  const tester = new AudioSelectorTester();
  tester.audioTracks = [
    { language: 'it-IT', active: true, primary: true },
    { language: 'en-US', active: false, primary: false },
    { language: 'id-ID', active: false, primary: false },
  ];

  tester.applyAudioSelection();
  assert.strictEqual(tester.selectedTrack.language, 'id-ID', 'Harus mencocokkan kode regional id-ID dengan prioritas id');
  console.log('✓ TEST 4 PASS: Regional code id-ID dicocokkan dengan aman');

  // Variasi ISO 3-letter ('ind', 'eng')
  const testerIso = new AudioSelectorTester();
  testerIso.audioTracks = [
    { language: 'ita', active: true },
    { language: 'eng', active: false },
    { language: 'ind', active: false },
  ];
  testerIso.applyAudioSelection();
  assert.strictEqual(testerIso.selectedTrack.language, 'ind', 'Harus mencocokkan kode 3-huruf ind');
  console.log('✓ TEST 4b PASS: 3-letter ISO code (ind/eng) dinormalisasi dengan benar');
}

// Test 5: Pengguna memilih English secara manual -> Pilihan tidak ditimpa
{
  const tester = new AudioSelectorTester();
  tester.audioTracks = [
    { language: 'it', active: false },
    { language: 'en', active: false },
    { language: 'id', active: false },
  ];

  // User manually selects English
  const enTrack = tester.audioTracks.find(t => t.language === 'en');
  tester.isManualAudioSelected = true;
  tester.manualAudioLanguage = 'en';
  tester.selectAudioTrack(enTrack);

  // Auto selector runs again (e.g. periodically or on event)
  tester.applyAudioSelection();
  assert.strictEqual(tester.selectedTrack.language, 'en', 'Pilihan manual pengguna tidak boleh ditimpa oleh auto-selector');
  console.log('✓ TEST 5 PASS: Manual user choice (English) tidak ditimpa meskipun Indonesia tersedia');
}

// Test 6: Manifest / daftar track diperbarui
{
  const tester = new AudioSelectorTester();
  tester.isManualAudioSelected = true;
  tester.manualAudioLanguage = 'en-US';

  // Manifest update has en-GB instead of en-US (same base language)
  tester.audioTracks = [
    { language: 'it-IT', active: true },
    { language: 'en-GB', active: false },
    { language: 'id-ID', active: false },
  ];

  tester.applyAudioSelection();
  assert.strictEqual(tester.selectedTrack.language, 'en-GB', 'Harus tetap mencocokkan bahasa manual pengguna pada track update');
  console.log('✓ TEST 6 PASS: Manifest track update mempertahankan bahasa pilihan pengguna');
}

// Test 7: Penggantian kualitas tidak mengganti bahasa audio
{
  const tester = new AudioSelectorTester();
  // Video variants with different audio languages paired at 1080p and 720p
  tester.variantTracks = [
    { id: 1, height: 1080, language: 'it', audioId: 10, active: false },
    { id: 2, height: 1080, language: 'id', audioId: 20, active: true }, // Current active (Indonesian 1080p)
    { id: 3, height: 720,  language: 'it', audioId: 10, active: false },
    { id: 4, height: 720,  language: 'id', audioId: 20, active: false }, // Indonesian 720p
  ];

  // User changes quality to 720p
  tester.selectResolution(720);
  assert.strictEqual(tester.selectedVariant.id, 4, 'Harus memilih variant 720p yang memiliki audio Indonesian');
  assert.strictEqual(tester.selectedVariant.language, 'id', 'Bahasa audio tidak boleh berubah saat ganti resolusi');
  console.log('✓ TEST 7 PASS: Penggantian resolusi (1080p -> 720p) mempertahankan audio Indonesia');
}

// Test 8: Tidak ada track audio yang cocok / list kosong -> Aman, tidak error
{
  const tester = new AudioSelectorTester();
  tester.audioTracks = [];
  assert.doesNotThrow(() => {
    tester.applyAudioSelection();
  }, 'Audio selection pada array kosong tidak boleh melempar exception');
  assert.strictEqual(tester.selectedTrack, null);
  console.log('✓ TEST 8 PASS: Audio selector menangani track kosong tanpa error');
}

console.log('\n=== ALL 8 UNIT TESTS PASSED SUCCESSFULLY! ===\n');
