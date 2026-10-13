const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testSubSync() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9233',
    '--disable-gpu',
    '--disable-extensions',
    '--no-sandbox',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-certificate-errors',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9233/json/list', r => {
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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://localhost:8000/player.html' });
    await new Promise(r => setTimeout(r, 4000));

    // 1. Load Indonesian subtitle from alchemy_of_souls_s01e01_id.srt
    console.log('--- 1. Loading Indonesian Subtitle ---');
    const loadRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          const track = await p.player.addTextTrackAsync(
            '/alchemy_of_souls_s01e01_id.srt',
            'id',
            'subtitles',
            'text/srt',
            undefined,
            'Indonesia'
          );
          p.player.selectTextTrack(track);
          return {
            selectedTrackLang: track.language,
            activeTrack: p.player.getTextTracks().find(t => t.active)?.language
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Load result:', loadRes.result.value);

    // 2. Play and seek to 6.5s (inside Cue 1: 00:00:06,006 --> 00:00:08,466 "SERIAL NETFLIX")
    console.log('\n--- 2. Checking Cue at Normal Playback (6.5s) ---');
    const cueAt6_5 = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.currentTime = 6.5;
          await p.video.play();
          await new Promise(r => setTimeout(r, 600));

          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');
          const activeCues = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          return {
            currentTime: p.video.currentTime,
            activeCues: activeCues
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('At 6.5s (normal speed):', cueAt6_5.result.value);

    // 3. Speed up video to 2x (playbackRate = 2.0)
    console.log('\n--- 3. Testing Speed Up (2.0x) ---');
    const speedTest = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.currentTime = 6.2;
          p.video.playbackRate = 2.0;
          await new Promise(r => setTimeout(r, 400));

          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');
          const activeDuring = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          // Wait another 1.5s at 2x speed (advances ~3s to > 9s, past end time 8.466s)
          await new Promise(r => setTimeout(r, 1500));
          const activeAfter = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          return {
            playbackRate: p.video.playbackRate,
            activeDuring2x: activeDuring,
            timeAfter: p.video.currentTime,
            activeAfterPassed: activeAfter
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Speed up 2x results:', speedTest.result.value);

    // 4. Test Seek / Skip
    console.log('\n--- 4. Testing Skip & Seek Synchronization ---');
    const skipTest = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.playbackRate = 1.0;

          // Skip to 3s (before cue 1 starts at 6s)
          p.video.currentTime = 3.0;
          await new Promise(r => setTimeout(r, 400));
          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');
          const cuesAt3s = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          // Jump immediately to 7.0s (inside cue 1)
          p.video.currentTime = 7.0;
          await new Promise(r => setTimeout(r, 400));
          const cuesAt7s = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          // Jump to 20.0s (past cue 1)
          p.video.currentTime = 20.0;
          await new Promise(r => setTimeout(r, 400));
          const cuesAt20s = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          return {
            cuesAt3s,
            cuesAt7s,
            cuesAt20s
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Skip / Seek results:', skipTest.result.value);

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}
testSubSync();
