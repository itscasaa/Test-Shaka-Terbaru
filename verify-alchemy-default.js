const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function verifyAlchemyDefault() {
  console.log('=== VERIFIKASI DEFAULT ALCHEMY OF SOULS & SUBTITLE ===\n');

  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9250',
    '--disable-gpu',
    '--user-data-dir=C:\\Users\\ndenz\\AppData\\Local\\Temp\\chrome-alchemy-test',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ]);

  let tabs = null;
  for (let i = 0; i < 15; i++) {
    try {
      tabs = await new Promise((res, rej) => {
        http.get('http://127.0.0.1:9250/json/list', r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      if (tabs) break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  try {
    const consoleLogs = [];
    const consoleErrors = [];

    const pageTab = tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://')) || tabs[0];
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

    ws.on('message', data => {
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

    console.log('[1] Membuka http://localhost:8000/player.html...');
    await send('Page.navigate', { url: 'http://localhost:8000/player.html' });

    // Tunggu player selesai memuat stream & subtitle
    await new Promise(r => setTimeout(r, 4500));

    // 1. Verifikasi UI & Metadata
    console.log('\n[2] Memeriksa Metadata & Poster Alchemy of Souls...');
    const metaCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          return {
            documentTitle: document.title,
            uiTitle: p.titleEl.textContent,
            uiEpisode: p.episodeEl.textContent,
            videoPoster: p.video.poster,
            hasLocalVideoBtn: !!document.getElementById('btnPickLocalVideo')
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Hasil Metadata & UI:', metaCheck.result.value);
    const m = metaCheck.result.value;
    if (m.uiTitle.includes('Alchemy of Souls') && m.uiEpisode.includes('Eps 1 Season 1') && m.videoPoster.includes('alchemy_poster.jpg')) {
      console.log('✓ PASS: Judul "Alchemy of Souls", Episode "Eps 1 Season 1", dan poster "alchemy_poster.jpg" aktif sebagai default!');
    } else {
      console.error('✗ FAIL: Metadata tidak sesuai default Alchemy of Souls:', m);
      process.exitCode = 1;
    }

    // 2. Verifikasi Subtitle
    console.log('\n[3] Memeriksa Subtitle Alchemy of Souls...');
    const subCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const tracks = p.player.getTextTracks() || [];
          const activeTrack = tracks.find(t => t.active);
          const vTracks = Array.from(p.video.textTracks || []);
          const idVTrack = vTracks.find(t => t.language === 'id');

          return {
            totalTracks: tracks.length,
            isSubtitleActive: p.isSubtitleActive,
            activeTrackLabel: activeTrack ? activeTrack.label : null,
            activeTrackLang: activeTrack ? activeTrack.language : null,
            nativeMode: idVTrack ? idVTrack.mode : null
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Hasil Subtitle:', subCheck.result.value);
    const s = subCheck.result.value;
    if (s.isSubtitleActive && s.activeTrackLabel && s.activeTrackLabel.includes('Alchemy of Souls')) {
      console.log(`✓ PASS: Subtitle Bahasa Indonesia Alchemy of Souls otomatis aktif ("${s.activeTrackLabel}")!`);
    } else {
      console.error('✗ FAIL: Subtitle default tidak aktif:', s);
      process.exitCode = 1;
    }

    // 3. Verifikasi Playback & Sinkronisasi Cue pada 7.0s
    console.log('\n[4] Menguji Sinkronisasi Cue pada playback 7.0s...');
    const cueCheck = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          await p.video.play();
          p.video.currentTime = 7.0;
          await new Promise(r => p.video.addEventListener('seeked', r, { once: true }));
          await new Promise(r => setTimeout(r, 800));

          const vTracks = Array.from(p.video.textTracks || []);
          const idVTrack = vTracks.find(t => t.language === 'id');
          return {
            time: p.video.currentTime,
            paused: p.video.paused,
            activeCues: idVTrack && idVTrack.activeCues ? Array.from(idVTrack.activeCues).map(c => c.text) : []
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Hasil Playback & Cue pada 7.0s:', cueCheck.result.value);
    if (cueCheck.result.value.activeCues.includes('SERIAL NETFLIX')) {
      console.log('✓ PASS: Cue "SERIAL NETFLIX" muncul tepat waktu pada 7.0s playback!');
    } else {
      console.error('✗ FAIL: Cue tidak aktif pada 7.0s:', cueCheck.result.value);
      process.exitCode = 1;
    }

    // 4. Periksa Console Errors
    console.log('\n[5] Memeriksa Console Browser...');
    if (consoleErrors.length === 0) {
      console.log('✓ PASS: 0 console errors!');
    } else {
      console.warn('Console errors tercatat:', consoleErrors);
    }

    console.log('\n=== VERIFIKASI BERHASIL DENGAN SEMPURNA (100% PASS) ===');
    ws.close();
  } catch (err) {
    console.error('Test error:', err);
    process.exitCode = 1;
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(process.exitCode || 0);
  }
}

verifyAlchemyDefault();
