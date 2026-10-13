const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function testAudioLive() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9225',
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
      http.get('http://127.0.0.1:9225/json/list', r => {
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

    console.log('Waiting for player load...');
    await new Promise(r => setTimeout(r, 4000));

    // Evaluate current state and play
    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          try {
            const p = window.customPlayer;
            await p.video.play();
            const initialTracks = p.player.getAudioTracks();
            const activeInitial = initialTracks.find(t => t.active);
            const itTrack = initialTracks.find(t => t.language === 'it');
            
            return {
              playing: !p.video.paused,
              currentTime: p.video.currentTime,
              activeInitial: activeInitial ? { id: activeInitial.id, lang: activeInitial.language } : null,
              itTrack: itTrack ? { id: itTrack.id, lang: itTrack.language } : null
            };
          } catch (e) {
            return { error: e.toString() };
          }
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Initial playback state:', evalRes.result.value);

    // Now call selectAudioTrack to 'it'
    const switchRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          const p = window.customPlayer;
          const initialTracks = p.player.getAudioTracks();
          const itTrack = initialTracks.find(t => t.language === 'it');
          
          const timeBefore = p.video.currentTime;
          p.player.selectAudioTrack(itTrack);
          
          // Let it play for 2 seconds
          await new Promise(r => setTimeout(r, 2000));
          
          const afterTracks = p.player.getAudioTracks();
          const afterActive = afterTracks.find(t => t.active);
          const timeAfter = p.video.currentTime;
          const currentVariant = p.player.getVariantTracks().find(v => v.active);

          return {
            timeBefore,
            timeAfter,
            activeAfter: afterActive ? { id: afterActive.id, lang: afterActive.language } : null,
            variantActiveAudioLang: currentVariant ? currentVariant.language : null,
            paused: p.video.paused
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('After switch state:', switchRes.result.value);

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    chrome.kill('SIGKILL');
  }
}
testAudioLive();
