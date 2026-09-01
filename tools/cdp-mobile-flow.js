// CDP 交互流程脚本：手机竖屏仿真 → 快速演示模式进游戏 → 截图（横屏引导 + HUD）
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 9334;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT1 = 'C:\\tmp\\yysh-m-rotate.png';
const OUT2 = 'C:\\tmp\\yysh-m-game.png';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-flow-profile',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: 'ignore' });

const wait = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${PORT}/json/list`, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await wait(500);
  }
  throw new Error('CDP not ready');
}

(async () => {
  const ws = new WebSocket(await getWs());
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
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
  const evaljs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true })).result;
  const shot = async (out) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
    console.log('saved', out);
  };

  // iPhone 竖屏仿真
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8616/?quick=1' });
  await wait(3000);

  // 进准备页 → 勾选 → 出发
  await evaljs(`document.getElementById('btn-start').click()`);
  await wait(500);
  await evaljs(`document.getElementById('ck-safety').click(); document.getElementById('ck-demo').click();`);
  await wait(300);
  await evaljs(`document.getElementById('ck-auto').click(); document.getElementById('btn-begin').click();`);
  await wait(4000);
  await shot(OUT1);  // 竖屏横屏引导

  // 旋转为横屏
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await evaljs(`window.dispatchEvent(new Event('resize'))`);
  await wait(500);
  // 关闭景点介绍卡
  await evaljs(`var b=document.getElementById('btn-scene-intro-ok'); if(b && !document.getElementById('scene-intro-overlay').classList.contains('hidden')) b.click();`);
  await wait(4000);
  await shot(OUT2);  // 横屏游戏 HUD

  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); chrome.kill(); process.exit(1); });
