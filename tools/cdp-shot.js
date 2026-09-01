// CDP 截图脚本：Node 24+ 内置 WebSocket，无需依赖
// 用法: node cdp-shot.js <url> <out.png> <width> <height> [mobile]
const { spawn, execSync } = require('child_process');
const http = require('http');

const [url, out, W = '390', H = '844', mobile = '1'] = process.argv.slice(2);
const PORT = 9333;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-shot-profile',
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
    width: +W, height: +H, deviceScaleFactor: 2, mobile: mobile === '1',
  });
  if (mobile === '1') await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await wait(3500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error(e.message); chrome.kill(); process.exit(1); });
