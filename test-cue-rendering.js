const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testCueRendering() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9231',
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
      http.get('http://127.0.0.1:9231/json/list', r => {
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

    // Load subtitle and seek to 7s
    const res7s = await send('Runtime.evaluate', {
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

          // Seek to 7s (cue 1 is active from 6.006s to 8.466s)
          p.video.currentTime = 7;
          await new Promise(r => setTimeout(r, 500));

          // Check native text tracks on video element
          const videoTracks = Array.from(p.video.textTracks || []);
          const activeCues = videoTracks.map(vt => ({
            label: vt.label,
            language: vt.language,
            mode: vt.mode,
            cuesCount: vt.cues ? vt.cues.length : 0,
            activeCues: vt.activeCues ? Array.from(vt.activeCues).map(c => c.text) : []
          }));

          // Check if there are any DOM subtitle containers (like shaka-text-container)
          const textContainers = Array.from(document.querySelectorAll('.shaka-text-container, .shaka-text-displayer, [class*="shaka-text"]')).map(el => ({
            className: el.className,
            text: el.textContent
          }));

          return {
            currentTime: p.video.currentTime,
            activeTrack: p.player.getTextTracks().find(t => t.active),
            videoTracks: activeCues,
            textContainers: textContainers
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Result at 7s:', JSON.stringify(res7s.result.value, null, 2));

    // Now seek to 89s (cue 2: "Aduh, kasihan sekali.")
    const res89s = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          p.video.currentTime = 89;
          await new Promise(r => setTimeout(r, 500));

          const videoTracks = Array.from(p.video.textTracks || []);
          const activeCues = videoTracks.map(vt => ({
            label: vt.label,
            activeCues: vt.activeCues ? Array.from(vt.activeCues).map(c => c.text) : []
          }));

          return {
            currentTime: p.video.currentTime,
            videoTracks: activeCues
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Result at 89s:', JSON.stringify(res89s.result.value, null, 2));

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}
testCueRendering();
