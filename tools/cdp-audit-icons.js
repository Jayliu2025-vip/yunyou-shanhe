// 图标体系验收截图：桌面四屏 + 手机全流程（含预置数据解锁徽章墙）
// 用法: node tools/cdp-audit-icons.js
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 9337;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\tmp\\yysh-audit';
fs.mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-audit-profile',
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
    } catch (e) { /* retry */ }
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
  const evaljs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page JS error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}\\${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('saved', name);
  };

  // 预置训练数据：解锁 part 徽章 + 首页统计卡有数字
  const SEED = `
    localStorage.setItem('yysn_sessions', JSON.stringify([
      { date: '${new Date().toDateString()}', steps: 1820, distanceKm: 1.32, durationSec: { total: 1260 }, kcal: 96, avgCadence: 92, sitStandReps: 12, stampsEarned: 12, scenesCompleted: 1, endedBy: 'completed', rpeSamples: [{ v: 3, t: 300 }] },
      { date: '${new Date(Date.now() - 864e5).toDateString()}', steps: 1600, distanceKm: 1.1, durationSec: { total: 1100 }, kcal: 88, avgCadence: 90, sitStandReps: 8, stampsEarned: 6, scenesCompleted: 0, endedBy: 'completed', rpeSamples: [] },
      { date: '${new Date(Date.now() - 2 * 864e5).toDateString()}', steps: 1400, distanceKm: 0.9, durationSec: { total: 1000 }, kcal: 80, avgCadence: 88, sitStandReps: 0, stampsEarned: 4, scenesCompleted: 0, endedBy: 'completed', rpeSamples: [] }
    ]));
    localStorage.setItem('yysn_journey', JSON.stringify({ totalKm: 12.6, sceneIndex: 1, stampsInScene: 4, stampsTotal: 34, rounds: 0 }));
  `;

  const click = (sel) => evaljs(`document.getElementById('${sel}').click()`);

  /* ---------- 桌面 1280×900 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8616/' });
  await wait(2500);
  await evaljs(SEED);
  await evaljs(`location.reload()`);   // 重载让首页读入种子数据
  await wait(2500);
  await shot('01-home-desktop');

  await click('btn-start'); await wait(800);
  await shot('02-setup-desktop');

  // SPA 无历史记录，重新载入主页后再进文牒 / 设置
  await send('Page.navigate', { url: 'http://localhost:8616/' });
  await wait(2000);
  await click('btn-passport'); await wait(900);
  await shot('03-passport-desktop');

  await send('Page.navigate', { url: 'http://localhost:8616/' });
  await wait(2000);
  await click('btn-settings'); await wait(700);
  await shot('04-settings-desktop');

  // 微信内打开引导（图标按钮圆片）
  await send('Page.navigate', { url: 'http://localhost:8616/?wechat=1' });
  await wait(2500);
  await shot('05-wechat-desktop');

  /* ---------- 手机 390×844 全流程 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await send('Page.navigate', { url: 'http://localhost:8616/?quick=1' });
  await wait(2500);
  await evaljs(SEED);
  await evaljs(`location.reload()`);
  await wait(2500);
  await shot('06-home-mobile');

  await click('btn-start'); await wait(500);
  await evaljs(`document.getElementById('ck-safety').click(); document.getElementById('ck-demo').click();`);
  await wait(300);
  await evaljs(`document.getElementById('ck-auto').click(); document.getElementById('btn-begin').click();`);
  await wait(3500);
  await shot('07-rotate-mobile');   // 竖屏横屏引导（smartphone/rotate-cw 图标）

  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await evaljs(`window.dispatchEvent(new Event('resize'))`);
  await wait(500);
  await evaljs(`var b=document.getElementById('btn-scene-intro-ok'); if(b && !document.getElementById('scene-intro-overlay').classList.contains('hidden')) b.click();`);
  await wait(4000);
  await shot('08-game-hud');        // HUD chips / 声音暂停结束 / 踏步按钮

  await evaljs(`document.getElementById('btn-rpe-quick').click()`);
  await wait(600);
  await shot('09-rpe-dialog');      // 7 档线性表情图标

  await evaljs(`var b=document.getElementById('btn-rpe-cancel'); if(b) b.click();
    var ov=document.getElementById('rpe-overlay'); if(ov && !ov.classList.contains('hidden')){
      var btns=ov.querySelectorAll('.rpe-btn'); btns[3].click(); }`);
  await wait(800);
  await evaljs(`document.getElementById('btn-game-stop').click()`);
  await wait(600);
  await shot('10-stop-confirm');
  await evaljs(`document.getElementById('btn-stop-confirm').click()`);
  await wait(1200);
  await shot('11-summary');         // 徽章墙 / 称号 / 统计卡

  chrome.kill(); process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); chrome.kill(); process.exit(1); });
