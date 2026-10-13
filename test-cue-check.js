const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9250/json/list', async r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', async () => {
    const tabs = JSON.parse(d);
    const tab = tabs.find(t => t.type === 'page');
    if (!tab) return console.log('No tab');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => {
            const p = window.customPlayer;
            await p.video.play();
            p.video.currentTime = 7.0;
            await new Promise(res => p.video.addEventListener('seeked', res, { once: true }));
            await new Promise(res => setTimeout(res, 200));

            const vTracks = Array.from(p.video.textTracks || []).map(t => ({
              label: t.label,
              lang: t.language,
              mode: t.mode,
              cuesLen: t.cues ? t.cues.length : null,
              activeCues: t.activeCues ? Array.from(t.activeCues).map(c => c.text) : []
            }));
            const sTracks = (p.player.getTextTracks() || []).map(t => ({
              label: t.label,
              lang: t.language,
              active: t.active
            }));
            return { vTracks, sTracks, curTime: p.video.currentTime };
          })()`,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });
    ws.on('message', data => {
      console.log('Result:', JSON.stringify(JSON.parse(data).result.result.value, null, 2));
      process.exit(0);
    });
  });
}).on('error', err => {
  console.error(err);
});
