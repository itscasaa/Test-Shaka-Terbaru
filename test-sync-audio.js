const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testSync() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9226',
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
      http.get('http://127.0.0.1:9226/json/list', r => {
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

    const res = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const tracks = p.player.getAudioTracks();
          const itTrack = tracks.find(t => t.language === 'it');
          const activeBefore = tracks.find(t => t.active);
          
          p.player.selectAudioTrack(itTrack);
          
          // Check IMMEDIATELY without waiting
          const tracksImmediately = p.player.getAudioTracks();
          const activeImmediately = tracksImmediately.find(t => t.active);
          
          return {
            activeBefore: activeBefore ? activeBefore.language : null,
            activeImmediately: activeImmediately ? activeImmediately.language : null
          };
        })()
      `,
      returnByValue: true
    });
    console.log('Result:', res.result.value);
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}
testSync();
