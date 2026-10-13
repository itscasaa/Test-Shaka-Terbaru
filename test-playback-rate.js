const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testRate() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9235',
    '--disable-gpu',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9235/json/list', r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });
    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
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
    await send('Console.enable');
    await send('Page.navigate', { url: 'http://localhost:8000/player.html' });
    await new Promise(r => setTimeout(r, 3500));
    ws.on('message', data => {
      const m = JSON.parse(data);
      if (m.method === 'Runtime.consoleAPICalled') {
        console.log('[Browser Console]', ...m.params.args.map(a => a.value || a.description));
      } else if (m.method === 'Runtime.exceptionThrown') {
        console.error('[Browser Exception]', m.params.exceptionDetails);
      }
    });

    const res = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          let attempts = 0;
          while (!window.customPlayer && attempts < 30) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
          }
          if (!window.customPlayer) return JSON.stringify({ error: 'customPlayer not found' });
          const p = window.customPlayer;
          const rateInit = p.video.playbackRate;
          p.video.playbackRate = 2.0;
          const rateSet = p.video.playbackRate;
          return JSON.stringify({ rateInit, rateSet });
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Playback rate test:', res);

    ws.close();
  } catch (err) {
    console.error(err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}

testRate();
