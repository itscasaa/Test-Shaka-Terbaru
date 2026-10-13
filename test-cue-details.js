const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testCueDetails() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9232',
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
      http.get('http://127.0.0.1:9232/json/list', r => {
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
        (async () => {
          const p = window.customPlayer;
          await p.video.play();

          const track = await p.player.addTextTrackAsync(
            '/alchemy_of_souls_s01e01_id.srt',
            'id',
            'subtitles',
            'text/srt',
            undefined,
            'Indonesia'
          );
          p.player.selectTextTrack(track);

          // Seek to 7s
          p.video.currentTime = 7;

          // Wait 2 seconds of playback around 7s
          await new Promise(r => setTimeout(r, 2000));

          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');

          return {
            currentTime: p.video.currentTime,
            mode: idTrack ? idTrack.mode : null,
            cuesCount: idTrack && idTrack.cues ? idTrack.cues.length : 0,
            activeCues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => ({
              startTime: c.startTime,
              endTime: c.endTime,
              text: c.text
            })) : [],
            firstFewCues: idTrack && idTrack.cues ? Array.from(idTrack.cues).slice(0, 5).map(c => ({
              startTime: c.startTime,
              endTime: c.endTime,
              text: c.text
            })) : []
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('Cue Details:', JSON.stringify(res.result.value, null, 2));
    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}
testCueDetails();
