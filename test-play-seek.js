const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testPlayAndSeek() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9244',
    '--disable-gpu',
    '--user-data-dir=C:\\Users\\ndenz\\AppData\\Local\\Temp\\chrome-sub-e2e2',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9244/json/list', r => {
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
    await new Promise(r => setTimeout(r, 4500));

    const res = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          await p.video.play();

          const getTimeAndCues = () => {
            const vTracks = Array.from(p.video.textTracks || []);
            const idTrack = vTracks.find(t => t.language === 'id');
            return {
              time: p.video.currentTime,
              paused: p.video.paused,
              ready: p.video.readyState,
              cues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : []
            };
          };

          // 1. Seek to 6.2s
          p.video.currentTime = 6.2;
          await new Promise(r => p.video.addEventListener('seeked', r, { once: true }));
          await new Promise(r => setTimeout(r, 200));
          const step1 = getTimeAndCues();

          // 2. Skip forward to 20s
          p.video.currentTime = 20.0;
          await new Promise(r => p.video.addEventListener('seeked', r, { once: true }));
          await new Promise(r => setTimeout(r, 200));
          const step2 = getTimeAndCues();

          // 3. Skip back to 7.0s
          p.video.currentTime = 7.0;
          await new Promise(r => p.video.addEventListener('seeked', r, { once: true }));
          await new Promise(r => setTimeout(r, 200));
          const step3 = getTimeAndCues();

          // 4. Play at 2x speed from 7.0s
          p.video.playbackRate = 2.0;
          await p.video.play();
          await new Promise(r => setTimeout(r, 300));
          const step4During = getTimeAndCues();

          await new Promise(r => setTimeout(r, 1200));
          const step5After = getTimeAndCues();

          return { step1, step2, step3, step4During, step5After };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Detailed Play & Seek Results:');
    console.log(JSON.stringify(res.result.value, null, 2));
    ws.close();
  } catch (err) {
    console.error(err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}

testPlayAndSeek();
