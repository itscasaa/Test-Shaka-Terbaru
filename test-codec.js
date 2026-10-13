const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testBothItTracks() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9228',
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
      http.get('http://127.0.0.1:9228/json/list', r => {
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

    // Test AAC Italian (matches current active video/audio container)
    const resAac = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const tracks = p.player.getAudioTracks();
          const itAac = tracks.find(t => t.language === 'it' && t.codecs && t.codecs.includes('mp4a'));
          p.player.selectAudioTrack(itAac);
          const active = p.player.getAudioTracks().find(t => t.active);
          return {
            selectedCodecs: itAac.codecs,
            activeCodecs: active ? active.codecs : null,
            activeLang: active ? active.language : null
          };
        })()
      `,
      returnByValue: true
    });
    console.log('Result AAC:', resAac.result.value);

    // Test Opus Italian
    const resOpus = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const tracks = p.player.getAudioTracks();
          const itOpus = tracks.find(t => t.language === 'it' && t.codecs && t.codecs.includes('opus'));
          p.player.selectAudioTrack(itOpus);
          const active = p.player.getAudioTracks().find(t => t.active);
          return {
            selectedCodecs: itOpus.codecs,
            activeCodecs: active ? active.codecs : null,
            activeLang: active ? active.language : null
          };
        })()
      `,
      returnByValue: true
    });
    console.log('Result Opus:', resOpus.result.value);

    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}
testBothItTracks();
