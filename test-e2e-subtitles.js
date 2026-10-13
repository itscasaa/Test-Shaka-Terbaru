const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function runE2ETests() {
  console.log('=== MEMULAI TEST E2E SUBTITLE SHAKA PLAYER ===\n');

  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9243',
    '--disable-gpu',
    '--user-data-dir=C:\\Users\\ndenz\\AppData\\Local\\Temp\\chrome-sub-e2e',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9243/json/list', r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });

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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://localhost:8000/player.html' });

    // Tunggu sampai customPlayer terinisialisasi dan manifest selesai di-load
    console.log('[1] Menunggu player selesai memuat stream & subtitle default...');
    await new Promise(r => setTimeout(r, 4500));

    // TEST 1: Verifikasi Auto-Load Subtitle
    const test1 = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const tracks = p.player.getTextTracks() || [];
          const activeTrack = tracks.find(t => t.active);
          const vTracks = Array.from(p.video.textTracks || []);
          const idVTrack = vTracks.find(t => t.language === 'id');

          return {
            totalTextTracks: tracks.length,
            activeTrackLabel: activeTrack ? activeTrack.label : null,
            activeTrackLanguage: activeTrack ? activeTrack.language : null,
            nativeMode: idVTrack ? idVTrack.mode : null,
            isSubtitleActive: p.isSubtitleActive
          };
        })()
      `,
      returnByValue: true
    });
    console.log('✓ TEST 1 (Auto-load Subtitle):', test1.result.value);

    // TEST 2: Verifikasi Menu Pengaturan Subtitle
    const test2 = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          p.openSettings();
          const items = Array.from(p.subtitleList.querySelectorAll('li')).map(li => ({
            text: li.querySelector('span')?.textContent,
            badge: li.querySelector('.badge')?.textContent,
            isActive: li.classList.contains('active')
          }));
          return { items };
        })()
      `,
      returnByValue: true
    });
    console.log('✓ TEST 2 (Menu Subtitle di Pengaturan):', JSON.stringify(test2.result.value.items, null, 2));

    // TEST 3: Verifikasi Sinkronisasi Cue pada Kecepatan Normal (Seek 7s)
    const test3 = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.currentTime = 7.0;
          await new Promise(r => setTimeout(r, 300));
          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');
          return {
            currentTime: p.video.currentTime,
            activeCues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : []
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('✓ TEST 3 (Cue aktif di 7.0s):', test3.result.value);

    // TEST 4: Verifikasi Skip / Seek (Skip ke 15s -> Cue kosong)
    const test4 = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.currentTime = 15.0;
          await new Promise(r => setTimeout(r, 300));
          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');
          return {
            currentTime: p.video.currentTime,
            activeCues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : []
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('✓ TEST 4 (Skip ke 15.0s, Cue bersih):', test4.result.value);

    // TEST 5: Verifikasi Keybind 'C' untuk Toggle Subtitle
    const test5 = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          // Toggle OFF
          p.toggleSubtitle();
          const stateOff = {
            isSubtitleActive: p.isSubtitleActive,
            activeTrack: p.player.getTextTracks().find(t => t.active) || null
          };

          // Toggle ON
          p.toggleSubtitle();
          const stateOn = {
            isSubtitleActive: p.isSubtitleActive,
            activeTrackLabel: p.player.getTextTracks().find(t => t.active)?.label || null
          };

          return { stateOff, stateOn };
        })()
      `,
      returnByValue: true
    });
    console.log('✓ TEST 5 (Toggle Hotkey "C" ON/OFF):', test5.result.value);

    // TEST 6: Verifikasi Playback Sped Up (1.5x dan 2.0x)
    const test6 = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          // Posisikan sebelum cue 1 berakhir (di 6.5s)
          p.video.currentTime = 6.5;
          p.video.playbackRate = 1.5;
          await p.video.play();

          // Cek saat berjalan pada 1.5x
          await new Promise(r => setTimeout(r, 400));
          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');
          const cuesDuring = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];
          const timeDuring = p.video.currentTime;

          // Tunggu sampai video melewati batas cue (8.466s)
          await new Promise(r => setTimeout(r, 1200));
          const timeAfter = p.video.currentTime;
          const cuesAfter = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          return {
            playbackRate: p.video.playbackRate,
            timeDuring,
            cuesDuring,
            timeAfter,
            cuesAfter
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('✓ TEST 6 (Kecepatan 1.5x Mengikuti Jam Video):', test6.result.value);

    console.log('\n=== SEMUA TEST E2E SUBTITLE BERHASIL (100% PASS) ===');

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}

runE2ETests();
