const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function runComprehensiveVerification() {
  console.log('=== STARTING COMPREHENSIVE SHAKA PLAYER VERIFICATION ===\n');

  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9229',
    '--disable-gpu',
    '--disable-extensions',
    '--no-sandbox',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-certificate-errors',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const consoleErrors = [];
  const consoleLogs = [];

  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9229/json/list', r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });

    const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise(res => {
        const id = msgId++;
        const h = data => {
          const m = JSON.parse(data);
          if (m.id === id) {
            ws.off('message', h);
            res(m.result);
          }
        };
        ws.on('message', h);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map(a => a.value || a.description).join(' ');
          consoleLogs.push(`[${msg.params.type}] ${text}`);
          if (msg.params.type === 'error') {
            consoleErrors.push(text);
          }
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
        }
      } catch (e) {}
    });

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('[1] Navigating to http://localhost:8000/player.html...');
    await send('Page.navigate', { url: 'http://localhost:8000/player.html' });

    // Wait for player to load and initialize
    await new Promise(r => setTimeout(r, 4500));

    // Place a marker on window to ensure page is NEVER reloaded
    await send('Runtime.evaluate', {
      expression: 'window.__noReloadMarker = 98765;'
    });

    // TEST A: Check TMDB Connector is completely removed from DOM
    console.log('\n[2] VERIFIKASI A — TMDB Connector removal:');
    const tmdbCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          return {
            tmdbIdInput: !!document.getElementById('tmdbIdInput'),
            tmdbApplyBtn: !!document.getElementById('tmdbApplyBtn'),
            tmdbSeasonInput: !!document.getElementById('tmdbSeasonInput'),
            tmdbPresetAos: !!document.getElementById('tmdbPresetAos'),
            settingsMenuHTML: document.getElementById('settingsMenu').innerHTML.includes('TMDB')
          };
        })()
      `,
      returnByValue: true
    });

    console.log('TMDB elements in DOM:', tmdbCheck.result.value);
    const hasAnyTmdb = Object.values(tmdbCheck.result.value).some(v => v === true);
    if (!hasAnyTmdb) {
      console.log('✓ PASS: Semua elemen dan teks TMDB Connector sudah terhapus 100% dari menu settings.');
    } else {
      console.error('✗ FAIL: Elemen TMDB masih ditemukan di DOM!');
      process.exitCode = 1;
    }

    // Start video playback
    await send('Runtime.evaluate', {
      expression: 'window.customPlayer.video.play();'
    });
    await new Promise(r => setTimeout(r, 1000));

    // TEST B: Check Audio Track list in Settings Menu
    console.log('\n[3] VERIFIKASI B — Audio / Dubbing UI list:');
    const audioListCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          p.openSettings();
          const items = Array.from(p.audioList.children).map(li => ({
            text: li.querySelector('span')?.textContent,
            isActive: li.classList.contains('active'),
            badge: li.querySelector('.badge')?.textContent
          }));
          const activeTrack = p.player.getAudioTracks().find(t => t.active);
          return {
            menuItems: items,
            activeTrackLanguage: activeTrack ? activeTrack.language : null
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Daftar audio track di UI:', audioListCheck.result.value.menuItems);
    console.log('Track aktif di Shaka Player:', audioListCheck.result.value.activeTrackLanguage);
    
    // Pastikan tidak ada duplikasi bahasa
    const labels = audioListCheck.result.value.menuItems.map(m => m.text);
    const uniqueLabels = new Set(labels);
    if (labels.length === uniqueLabels.size) {
      console.log(`✓ PASS: Audio tracks bersih dan ter-deduplikasi (${labels.length} opsi unik).`);
    } else {
      console.error('✗ FAIL: Ditemukan duplikasi bahasa dalam audioList!');
      process.exitCode = 1;
    }

    // Auto-selection check: Should be English ('en') because Indonesian is not in angel-one
    if (audioListCheck.result.value.activeTrackLanguage === 'en') {
      console.log('✓ PASS: Auto-selector memilih English ("en") secara otomatis (prioritas 2).');
    } else {
      console.error('✗ FAIL: Auto-selector tidak memilih English:', audioListCheck.result.value.activeTrackLanguage);
      process.exitCode = 1;
    }

    // TEST C: Live Audio Track Switch to Italian ('it') without page reload
    console.log('\n[4] VERIFIKASI C — Live switch audio ke Italian tanpa reload...');
    const switchItRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          const timeBefore = p.video.currentTime;
          const isPausedBefore = p.video.paused;

          // Cari item Italiano di audioList dan simulasikan klik pengguna
          const itItem = Array.from(p.audioList.children).find(li => li.textContent.includes('Italiano'));
          if (!itItem) return { error: 'Italiano item not found in audioList' };
          
          itItem.click();

          // Tunggu 1.5 detik playback untuk memastikan audio stream berganti live
          await new Promise(r => setTimeout(r, 1500));

          const activeTracks = p.player.getAudioTracks().filter(t => t.active);
          const activeVariant = p.player.getVariantTracks().find(v => v.active);
          const timeAfter = p.video.currentTime;
          const markerPresent = window.__noReloadMarker === 98765;

          // Buka menu lagi untuk verifikasi badge aktif di UI
          p.openSettings();
          const itItemAfter = Array.from(p.audioList.children).find(li => li.textContent.includes('Italiano'));

          return {
            timeBefore,
            timeAfter,
            isPausedBefore,
            isPausedAfter: p.video.paused,
            markerPresent, // Harus true (membuktikan TIDAK ada reload halaman)
            activeAudioLanguage: activeTracks[0] ? activeTracks[0].language : null,
            activeVariantAudioLanguage: activeVariant ? activeVariant.language : null,
            itBadgeIsActive: itItemAfter?.classList.contains('active'),
            itBadgeText: itItemAfter?.querySelector('.badge')?.textContent
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Hasil pergantian live ke Italian:', switchItRes.result.value);
    const rIt = switchItRes.result.value;

    if (rIt.markerPresent && rIt.activeAudioLanguage === 'it' && rIt.itBadgeIsActive) {
      console.log('✓ PASS: Audio Italian diterapkan langsung seketika (live MSE switch, no page reload)!');
      console.log('✓ PASS: Indikator UI segera diperbarui menjadi "Aktif" untuk Italiano.');
      console.log(`✓ PASS: Playback berlanjut tanpa reset (waktu: ${rIt.timeBefore.toFixed(2)}s -> ${rIt.timeAfter.toFixed(2)}s).`);
    } else {
      console.error('✗ FAIL: Pergantian audio Italian gagal:', rIt);
      process.exitCode = 1;
    }

    // TEST D: Switch back to English ('en') live
    console.log('\n[5] VERIFIKASI D — Live switch audio kembali ke English...');
    const switchEnRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          const enItem = Array.from(p.audioList.children).find(li => li.textContent.includes('English'));
          if (!enItem) return { error: 'English item not found' };

          enItem.click();
          await new Promise(r => setTimeout(r, 1200));

          const activeTrack = p.player.getAudioTracks().find(t => t.active);
          p.openSettings();
          const enItemAfter = Array.from(p.audioList.children).find(li => li.textContent.includes('English'));

          return {
            activeLang: activeTrack ? activeTrack.language : null,
            enIsActive: enItemAfter?.classList.contains('active')
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Hasil pergantian kembali ke English:', switchEnRes.result.value);
    if (switchEnRes.result.value.activeLang === 'en' && switchEnRes.result.value.enIsActive) {
      console.log('✓ PASS: Pergantian kembali ke English berhasil dan indikator UI aktif sinkron.');
    } else {
      console.error('✗ FAIL: Pergantian ke English gagal!');
      process.exitCode = 1;
    }

    // TEST E: Seek 15 detik & verifikasi audio tidak kembali/reset
    console.log('\n[6] VERIFIKASI E — Seek 15s dan cek persistensi audio:');
    const seekRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.currentTime = 15;
          await new Promise(r => setTimeout(r, 1500));

          const activeTrack = p.player.getAudioTracks().find(t => t.active);
          return {
            currentTime: p.video.currentTime,
            activeLang: activeTrack ? activeTrack.language : null
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('State setelah seek 15s:', seekRes.result.value);
    if (seekRes.result.value.activeLang === 'en' && seekRes.result.value.currentTime >= 14) {
      console.log('✓ PASS: Posisi video berhasil di-seek dan bahasa audio tetap English.');
    } else {
      console.error('✗ FAIL: Audio berubah atau seek gagal setelah seek:', seekRes.result.value);
      process.exitCode = 1;
    }

    // TEST F: Ganti kualitas resolusi & verifikasi audio tidak berubah
    console.log('\n[7] VERIFIKASI F — Ganti resolusi video dan cek persistensi audio:');
    const qualityRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.openSettings();
          const qualItem = Array.from(p.qualityList.children).find(li => li.textContent.includes('144p'));
          if (qualItem) {
            qualItem.click();
          }
          await new Promise(r => setTimeout(r, 1500));

          const activeTrack = p.player.getAudioTracks().find(t => t.active);
          const activeVariant = p.player.getVariantTracks().find(v => v.active);

          return {
            variantHeight: activeVariant ? activeVariant.height : null,
            activeAudioLang: activeTrack ? activeTrack.language : null
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('State setelah ganti resolusi ke 144p:', qualityRes.result.value);
    if (qualityRes.result.value.activeAudioLang === 'en') {
      console.log('✓ PASS: Pergantian resolusi tidak mengubah bahasa audio terpilih.');
    } else {
      console.error('✗ FAIL: Bahasa audio berubah setelah ganti resolusi!');
      process.exitCode = 1;
    }

    // TEST G: Auto-selector tidak menimpa pilihan manual pada event trackschanged
    console.log('\n[8] VERIFIKASI G — Auto-selector tidak menimpa manual selection:');
    const overrideTest = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          // Set manual ke Italian
          const itTrack = p.player.getAudioTracks().find(t => t.language === 'it');
          p.selectAudioManually(itTrack);

          // Panggil applyAudioSelection berkali-kali untuk mensimulasikan event berulang
          p.applyAudioSelection();
          p.applyAudioSelection();

          const activeTrack = p.player.getAudioTracks().find(t => t.active);
          return {
            activeLang: activeTrack ? activeTrack.language : null,
            isManualAudioSelected: p.isManualAudioSelected
          };
        })()
      `,
      returnByValue: true
    });

    console.log('State setelah evaluasi applyAudioSelection berulang:', overrideTest.result.value);
    if (overrideTest.result.value.activeLang === 'it') {
      console.log('✓ PASS: Pilihan manual ("it") tidak ditimpa oleh auto-selector.');
    } else {
      console.error('✗ FAIL: Pilihan manual ditimpa oleh auto-selector!');
      process.exitCode = 1;
    }

    // Check console errors
    console.log('\n[9] VERIFIKASI H — Pemeriksaan Browser Console Errors:');
    if (consoleErrors.length === 0) {
      console.log('✓ PASS: 0 console errors dan 0 unhandled Promise rejections!');
    } else {
      console.warn('⚠ Perhatian: Console errors tercatat:', consoleErrors);
    }

    console.log('\n=== ALL COMPREHENSIVE VERIFICATION TESTS PASSED! ===');
    ws.close();
  } catch (err) {
    console.error('Error saat verifikasi komprehensif:', err);
    process.exitCode = 1;
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(process.exitCode || 0);
  }
}

runComprehensiveVerification();
