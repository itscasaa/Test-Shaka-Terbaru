const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function debugPage() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9241',
    '--disable-gpu',
    '--user-data-dir=C:\\Users\\ndenz\\AppData\\Local\\Temp\\chrome-sub-test',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const tabs = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:9241/json/list', r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
  console.log('All tabs:', tabs.map(t => ({ id: t.id, type: t.type, url: t.url })));
  const pageTab = tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://')) || tabs[0];
  console.log('Selected pageTab:', pageTab.url);
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let msgId = 1;
  const send = (m, p = {}) => new Promise(res => {
    const id = msgId++;
    ws.send(JSON.stringify({ id, method: m, params: p }));
    const h = d => { const x = JSON.parse(d); if (x.id === id) { ws.off('message', h); res(x.result); } };
    ws.on('message', h);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:8000/player.html' });
  await new Promise(r => setTimeout(r, 4000));

  const pageInfo = await send('Runtime.evaluate', {
    expression: JSON.stringify({
      code: `({
        url: window.location.href,
        readyState: document.readyState,
        title: document.title,
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src),
        hasShaka: typeof shaka !== 'undefined',
        hasCustomPlayer: typeof window.customPlayer !== 'undefined'
      })`
    }).replace(/^\{"code":"|"\}$/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    returnByValue: true
  });
  console.log('Page info:', pageInfo.result.value);
  ws.close();
  chrome.kill('SIGKILL');
}
debugPage();
