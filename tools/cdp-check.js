// CDP 检查脚本：验证 webfont 加载状态 + 截游戏画面（?quick=1 自动演示）
// 用法: node cdp-check.js <url> <out.png> <width> <height>
const { spawn } = require('child_process');
const http = require('http');

const [url, out, W = '844', H = '390'] = process.argv.slice(2);
const PORT = 9334;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-check-profile',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: 'ignore' });

const wait = ms => new Promise(r => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${PORT}/json/list`, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await wait(500);
  }
  throw new Error('CDP not ready');
}

(async () => {
  const ws = new WebSocket(await getTarget());
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  };
  await new Promise(r => ws.onopen = r);

  await send('Emulation.setDeviceMetricsOverride', {
    width: +W, height: +H, deviceScaleFactor: 2, mobile: true,
  });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await wait(6000);
  if (process.argv.includes('--canvas')) {
    // canvas 字体验证：等字体就绪后，量测楷体 webfont 与纯 serif 回退的文本宽度差
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.createElement('canvas');
        const measure = (font) => c.getContext('2d').measureText(font).width;
        return document.fonts.ready.then(() => JSON.stringify({
          webfont: measure('700 64px "LXGW WenKai GB Screen"'),
          serif: measure('700 64px serif'),
          systemkai: measure('700 64px KaiTi'),
          loaded: document.fonts.check('700 16px "LXGW WenKai GB Screen"', '云游山河康'),
        }));
      })()`,
      returnByValue: true, awaitPromise: true,
    });
    console.log('canvas-font-check:', r.result.value);
  }
  await wait(500);
  const check = await send('Runtime.evaluate', {
    expression: `(() => {
      const fam = 'LXGW WenKai GB Screen';
      return JSON.stringify({
        loaded: document.fonts.check('700 16px "' + fam + '"', '云游山河康'),
        statuses: [...document.fonts].map(f => f.family + ':' + f.status).filter(s => s.includes('LXGW')),
      });
    })()`,
    returnByValue: true,
  });
  console.log('font-check:', check.result.value);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error(e.message); chrome.kill(); process.exit(1); });
