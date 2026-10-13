const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

async function run() {
  console.log('Launching headless Chrome with DevTools Protocol...');
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--disable-gpu',
    '--disable-extensions',
    '--no-sandbox',
    '--mute-audio',
    '--ignore-certificate-errors',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  try {
    // Get debugger WebSocket URL for the page tab
    const tabs = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9223/json/list', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
    const wsUrl = pageTab.webSocketDebuggerUrl;
    console.log('Connected to Chrome page tab:', pageTab.id);

    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.on('open', r));

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const handler = (data) => {
          const msg = JSON.parse(data);
          if (msg.id === id) {
            ws.off('message', handler);
            resolve(msg.result);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.method === 'Runtime.consoleAPICalled') {
          console.log('[BROWSER CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || a.description).join(' '));
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          console.log('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
        }
      } catch (e) {}
    });

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Navigating to http://localhost:8000/player.html...');
    await send('Page.navigate', { url: 'http://localhost:8000/player.html' });

    // Wait for player to load stream
    console.log('Waiting for Shaka Player to load angel-one stream...');
    let activeAudio = null;
    let allAudios = [];

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const res = await send('Runtime.evaluate', {
        expression: `
          (() => {
            if (!window.customPlayer || !window.customPlayer.player) return null;
            const tracks = window.customPlayer.player.getAudioTracks();
            if (!tracks || !tracks.length) return null;
            const active = tracks.find(t => t.active);
            return {
              all: tracks.map(t => ({ lang: t.language, active: t.active, label: t.label })),
              active: active ? { lang: active.language, label: active.label } : null
            };
          })()
        `,
        returnByValue: true
      });

      if (res && res.result && res.result.value) {
        allAudios = res.result.value.all;
        activeAudio = res.result.value.active;
        if (activeAudio) break;
      }
    }

    console.log('\n--- REAL MANIFEST TRACKS DISCOVERED ---');
    console.log('Available audio tracks:', allAudios.map(a => `${a.lang} (active: ${a.active})`));
    console.log('Active audio track selected by player:', activeAudio);

    // Verify: Because Indonesian is not in angel-one, but English IS in angel-one,
    // the priority auto-selector must select 'en' (English)!
    if (activeAudio && activeAudio.lang === 'en') {
      console.log('✓ PASS: Shaka Player auto-selected English ("en") because Indonesian is not available!');
    } else {
      console.error('✗ FAIL: Active audio is not English:', activeAudio);
      process.exitCode = 1;
    }

    // Now test: Change video quality and verify audio does NOT change
    console.log('\n--- TESTING QUALITY SWITCH PRESERVES AUDIO ---');
    const qualityTest = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const variants = p.player.getVariantTracks();
          const heights = [...new Set(variants.map(v => v.height))].sort((a,b) => b-a);
          const targetHeight = heights[heights.length - 1]; // Lowest resolution
          
          // Trigger resolution selection via our method
          const candidates = variants.filter(v => v.height === targetHeight);
          const activeVariant = variants.find(v => v.active);
          const match = candidates.find(v => v.audioId === activeVariant.audioId) || candidates[0];
          
          p.player.configure({ abr: { enabled: false } });
          p.player.selectVariantTrack(match, false);

          const afterTracks = p.player.getAudioTracks();
          const afterActive = afterTracks.find(t => t.active);
          return {
            targetHeight,
            activeAfter: afterActive ? afterActive.language : null
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Resolution switched to:', qualityTest.result.value.targetHeight + 'p');
    console.log('Audio language after resolution switch:', qualityTest.result.value.activeAfter);
    if (qualityTest.result.value.activeAfter === 'en') {
      console.log('✓ PASS: Resolution switch preserved active audio language ("en")!');
    } else {
      console.error('✗ FAIL: Audio language changed upon quality switch!');
      process.exitCode = 1;
    }

    // Test: User manually switches to Italian ('it')
    console.log('\n--- TESTING MANUAL AUDIO SELECTION ---');
    const manualTest = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const p = window.customPlayer;
          const itTrack = p.player.getAudioTracks().find(t => t.language === 'it');
          if (!itTrack) return { error: 'Italian track not found' };
          
          p.isManualAudioSelected = true;
          p.manualAudioLanguage = 'it';
          p.player.selectAudioTrack(itTrack);

          // Now run applyAudioSelection again to ensure it does NOT override manual choice
          p.applyAudioSelection();

          const active = p.player.getAudioTracks().find(t => t.active);
          return {
            activeLang: active ? active.language : null
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Active audio after manual Italian selection + re-eval:', manualTest.result.value.activeLang);
    if (manualTest.result.value.activeLang === 'it') {
      console.log('✓ PASS: Manual audio selection (Italian) is strictly preserved!');
    } else {
      console.error('✗ FAIL: Manual selection was overridden!');
      process.exitCode = 1;
    }

    ws.close();
  } catch (err) {
    console.error('Error during CDP test:', err);
    process.exitCode = 1;
  } finally {
    chromeProc.kill('SIGKILL');
  }
}

run();
