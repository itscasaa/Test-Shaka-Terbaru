const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

async function verifySync() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9242',
    '--disable-gpu',
    '--user-data-dir=C:\\Users\\ndenz\\AppData\\Local\\Temp\\chrome-sub-test',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));

  try {
    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9242/json/list', r => {
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
    await new Promise(r => setTimeout(r, 4000));

    // Test sequence:
    // 1. Add track & select it
    // 2. Play normally, verify cue at 7s
    // 3. Skip to 2s (before cue 1 starts at 6.006s) -> cues should be empty []
    // 4. Skip forward to 7s (inside cue 1: 6.006s -> 8.466s) -> cues should have ["SERIAL NETFLIX"]
    // 5. Skip forward to 12s (past cue 1) -> cues should be empty []
    // 6. Test playback speedup at 1.5x and 2.0x: verify time advances properly and cue disappears after 8.466s
    const testResult = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          let attempts = 0;
          while (!(window.customPlayer && window.customPlayer.player) && attempts < 50) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
          }
          const p = window.customPlayer;
          if (!p || !p.player) throw new Error('Player failed to initialize');
          
          const track = await p.player.addTextTrackAsync(
            '/alchemy_of_souls_s01e01_id.srt',
            'id',
            'subtitles',
            'text/srt',
            undefined,
            'Indonesia'
          );
          p.player.selectTextTrack(track);

          // Get native HTML5 text track
          const vTracks = Array.from(p.video.textTracks || []);
          const idTrack = vTracks.find(t => t.language === 'id');

          const results = {};

          // Helper for reliable seeking
          const safeSeek = (targetTime) => new Promise(r => {
            let done = false;
            const timeout = setTimeout(() => {
              if (!done) { done = true; r(); }
            }, 1000);
            const onSeek = () => {
              if (!done) {
                done = true;
                clearTimeout(timeout);
                p.video.removeEventListener('seeked', onSeek);
                r();
              }
            };
            p.video.addEventListener('seeked', onSeek);
            p.video.currentTime = targetTime;
          });

          // Test A: Seek to 2.0s (Before cue starts at 6.006s)
          await safeSeek(2.0);
          await new Promise(r => setTimeout(r, 200));
          results.beforeCue_2s = {
            currentTime: p.video.currentTime,
            activeCues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : []
          };

          // Test B: Seek to 7.0s (Inside cue 1: 6.006s - 8.466s)
          await safeSeek(7.0);
          await new Promise(r => setTimeout(r, 200));
          results.insideCue_7s = {
            currentTime: p.video.currentTime,
            activeCues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : []
          };

          // Test C: Seek to 12.0s (After cue 1 ends at 8.466s)
          await safeSeek(12.0);
          await new Promise(r => setTimeout(r, 200));
          results.afterCue_12s = {
            currentTime: p.video.currentTime,
            activeCues: idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : []
          };

          // Test D: Playback at 2x speed (playbackRate = 2.0)
          await safeSeek(6.0);
          p.video.playbackRate = 2.0;
          await p.video.play();
          
          // After 0.4s (advances ~0.8s to ~6.8s -> inside cue)
          await new Promise(r => setTimeout(r, 400));
          const timeAtMid2x = p.video.currentTime;
          const cuesAtMid2x = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          // After another 1.2s (advances ~2.4s to ~9.2s -> past cue end 8.466s)
          await new Promise(r => setTimeout(r, 1200));
          const timeAtEnd2x = p.video.currentTime;
          const cuesAtEnd2x = idTrack && idTrack.activeCues ? Array.from(idTrack.activeCues).map(c => c.text) : [];

          results.speed2x = {
            playbackRate: p.video.playbackRate,
            timeAtMid: timeAtMid2x,
            cuesAtMid: cuesAtMid2x,
            timeAtEnd: timeAtEnd2x,
            cuesAtEnd: cuesAtEnd2x
          };

          return results;
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('SYNC TEST RESULTS:');
    console.log('Raw testResult:', JSON.stringify(testResult, null, 2));
    if (testResult && testResult.result && testResult.result.value) {
      console.log('Value:', JSON.stringify(testResult.result.value, null, 2));
    }

    ws.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
    process.exit(0);
  }
}

verifySync();
