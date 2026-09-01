/**
 * 主控制器：屏幕流转 + 事件接线
 * 主页 → 准备（安全确认/摄像头/心率带）→ 游戏（HUD/RPE/休息/暂停）
 *      → 结算（数据入库）→ 通关文牒 / 设置
 */
import { CONFIG, targetHrZone } from './config.js';
import { AudioCoach } from './audio.js';
import { HRMonitor } from './hr.js';
import { BodyInput } from './pose.js';
import { Game } from './game.js';
import { SCENES, loadScenePhotos } from './scenes.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
const QUICK = new URLSearchParams(location.search).has('quick'); // ?quick=1 快速体验（演示/测试）
const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

// 预加载景点实景照片（失败自动回退程序化场景）
loadScenePhotos();

/* ---------------- 全局状态 ---------------- */

let settings = store.getSettings();
const audio = new AudioCoach(settings);
const hr = new HRMonitor();
let body = null;            // BodyInput
let bodyMode = null;        // 'camera' | 'demo'
let game = null;
let journey = store.getJourney();
let selectedMainSec = store.getProfile().mainSec || 1200;
let prevBadgeIds = [];      // 本次训练前已有的徽章（用于结算时标记新徽章）
let setupPreviewRaf = null;
let restTimer = null;
let wakeLock = null;       // 手机屏幕常亮锁

applyCfgOverrides();

/* ---------------- 屏幕切换 ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

/* ---------------- 主页 ---------------- */

function renderHome() {
  const st = store.streakInfo();
  $('stat-streak').textContent = st.current;
  $('stat-km').textContent = store.getJourney().totalKm.toFixed(1);
  $('stat-stamps').textContent = store.getJourney().stampsTotal;
  $('stat-sessions').textContent = st.totalSessions;
  const last = store.lastSessionDate();
  const tips = [
    '建议穿着运动鞋，身前 2 米内留出活动空间。',
    '训练前避免空腹或饱腹，备好温水。',
    '如当日身体不适，休息也是康复的一部分。',
    '运动中保持"有点累但能说话"的强度最合适。',
  ];
  let tip = tips[new Date().getDate() % tips.length];
  if (last) {
    const d = new Date(last);
    tip += ` 上次训练：${d.getMonth() + 1}月${d.getDate()}日。`;
  }
  $('home-tip').textContent = tip;
}

/* ---------------- 准备页 ---------------- */

function renderSetup() {
  const p = store.getProfile();
  $('in-age').value = p.age;
  $('in-resthr').value = p.restingHr;
  $('ck-beta').checked = !!p.betaBlocker;
  const modeRadio = document.querySelector(`input[name="mode"][value="${p.mode}"]`);
  if (modeRadio) modeRadio.checked = true;
  selectedMainSec = p.mainSec || 1200;
  renderMainSecChoices();
  $('ck-demo').checked = false;
  $('ck-auto').checked = !!settings.autoWalkDemo;
  $('row-auto').classList.add('hidden');
  updateHrZoneText();
  updateCamStatus(bodyMode === 'camera' ? '已就绪 ✓' : '未开启');
}

function renderMainSecChoices() {
  const box = $('mainsec-choices');
  box.innerHTML = '';
  CONFIG.session.mainSecChoices.forEach(c => {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.className = c.sec === selectedMainSec ? 'active' : '';
    b.onclick = () => { selectedMainSec = c.sec; renderMainSecChoices(); };
    box.appendChild(b);
  });
}

function currentProfileFromForm() {
  return {
    age: clamp(parseInt($('in-age').value, 10) || 55, 30, 90),
    restingHr: clamp(parseInt($('in-resthr').value, 10) || 70, 40, 110),
    betaBlocker: $('ck-beta').checked,
    mode: document.querySelector('input[name="mode"]:checked').value,
    mainSec: selectedMainSec,
  };
}

function updateHrZoneText() {
  const p = currentProfileFromForm();
  const clinic = getSettingMode() === 'clinic';
  const z = targetHrZone(p.age, p.restingHr, {
    ...CONFIG.medical,
    intensityHigh: clinic ? CONFIG.medical.clinic.intensityHigh : CONFIG.medical.intensityHigh,
  });
  $('hr-zone-text').textContent = `${z.low} ~ ${z.high} 次/分${clinic ? '（院内·保守）' : ''}`;
  $('setting-hint').textContent = clinic
    ? '院内监护版：强度上限更保守（50%储备心率），心率超限8秒自动暂停，RPE 每3分钟询问一次，便于医护观察。'
    : '居家版：标准安全策略（心率超上限12秒自动暂停，RPE 每5分钟询问）。';
}

function getSettingMode() {
  const r = document.querySelector('input[name="setting"]:checked');
  return r ? r.value : 'home';
}

async function initCameraInSetup() {
  updateCamStatus('正在开启摄像头…');
  try {
    await ensureBody('camera');
    updateCamStatus('已就绪 ✓（看到骨架即识别成功）', 'ok');
    startSetupPreview();
  } catch (e) {
    console.error(e);
    const msg = e && e.name === 'NotAllowedError'
      ? '摄像头权限被拒绝：请点击浏览器地址栏的相机图标允许后重试'
      : '摄像头开启失败：' + (e.message || e);
    updateCamStatus(msg, 'err');
  }
}

function updateCamStatus(text, cls = '') {
  $('cam-status').textContent = text;
  $('cam-status').className = 'cam-status ' + cls;
}

function startSetupPreview() {
  cancelAnimationFrame(setupPreviewRaf);
  const loop = () => {
    if (body && bodyMode === 'camera' && !$('screen-setup').classList.contains('hidden')) {
      body.update(performance.now()); // 推理 + 更新状态
      body.drawPreview();
      setupPreviewRaf = requestAnimationFrame(loop);
    }
  };
  setupPreviewRaf = requestAnimationFrame(loop);
}

function stopSetupPreview() {
  cancelAnimationFrame(setupPreviewRaf);
  setupPreviewRaf = null;
}

async function ensureBody(mode) {
  if (body && bodyMode === mode) return body;
  if (body) { body.stop(); body = null; bodyMode = null; }
  body = new BodyInput($('cam-video'), $('game-cam-preview'));
  await body.init({ demo: mode === 'demo', autoWalk: settings.autoWalkDemo });
  bodyMode = mode;
  return body;
}

/* ---------------- 开始训练 ---------------- */

async function startSession() {
  if (!$('ck-safety').checked) {
    alert('请先勾选安全确认，确认今天适合运动。');
    return;
  }
  const profile = currentProfileFromForm();
  store.saveProfile(profile);

  audio.ensure();
  hideAllOverlays();

  // 输入模式：演示 or 摄像头
  const wantDemo = $('ck-demo').checked;
  try {
    await ensureBody(wantDemo ? 'demo' : 'camera');
  } catch (e) {
    alert('摄像头开启失败，可勾选"演示模式"先体验。\n' + (e.message || e));
    return;
  }
  settings.autoWalkDemo = $('ck-auto').checked;
  store.saveSettings(settings);
  if (bodyMode === 'demo') body.autoWalk = settings.autoWalkDemo;

  const clinic = getSettingMode() === 'clinic';
  const plan = QUICK
    ? { ...CONFIG.session.quickTest, mode: profile.mode, quick: true }
    : { warmupSec: CONFIG.session.warmupSec, mainSec: selectedMainSec, cooldownSec: CONFIG.session.cooldownSec, mode: profile.mode, quick: false };
  plan.hrZone = targetHrZone(profile.age, profile.restingHr, {
    ...CONFIG.medical,
    intensityHigh: clinic ? CONFIG.medical.clinic.intensityHigh : CONFIG.medical.intensityHigh,
  });
  plan.setting = clinic ? 'clinic' : 'home';
  if (clinic) {
    plan.hrOverLimitSec = CONFIG.medical.clinic.hrOverLimitPauseSec;
    plan.rpePromptIntervalSec = CONFIG.medical.clinic.rpePromptIntervalSec;
  }

  // 手机：屏幕常亮（防锻炼中途锁屏）+ 提示横屏
  if (IS_MOBILE && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* 忽略 */ }
  }

  stopSetupPreview();
  journey = store.getJourney();
  prevBadgeIds = store.badges().filter(b => b.got).map(b => b.id);

  showScreen('screen-game');
  body.setPointerTarget($('game-canvas'));
  $('game-cam-preview').classList.toggle('hidden', bodyMode !== 'camera');
  // 演示模式 + 触屏设备 → 显示踏步按钮
  $('btn-tap-step').classList.toggle('hidden', !(bodyMode === 'demo' && IS_MOBILE));
  rotateHint();

  game = new Game({
    canvas: $('game-canvas'),
    body, hr, audio, profile, journey, settings,
    onEvent: onGameEvent,
    onHud: updateHud,
  });
  game.start(plan);
}

/* ---------------- 游戏事件 ---------------- */

function onGameEvent(ev) {
  switch (ev.type) {
    case 'rpe':
      $('rpe-overlay').classList.remove('hidden');
      break;
    case 'scene-intro':
      showSceneIntro(ev.scene, ev.auto);
      break;
    case 'hr-pause':
      $('rest-reason').textContent =
        `心率 ${ev.bpm} 次/分，略高于目标上限。跟着圆圈深呼吸，恢复后继续。`;
      $('rest-overlay').classList.remove('hidden');
      startRestHrWatcher();
      break;
    case 'end':
      handleSessionEnd(ev.session, ev.journey);
      break;
  }
}

/* ---------------- 景点介绍卡 ---------------- */

function showSceneIntro(scene, auto = true) {
  if (!scene) return;
  // 开场介绍的 pause 在 game.start() 同步执行期内调用会失效，延后一帧
  const g = game;
  const doPause = () => { if (g && g.running && !g.paused) g.pause('scene-intro'); };
  $('scene-intro-img').src = scene.photo;
  $('scene-intro-img').onerror = function () { this.style.display = 'none'; };
  $('scene-intro-img').style.display = '';
  $('scene-intro-ch').textContent = scene.ch;
  $('scene-intro-name').textContent = scene.name;
  $('scene-intro-sub').textContent = scene.sub;
  $('scene-intro-text').textContent = scene.intro || '';
  $('scene-intro-tips').innerHTML = (scene.tips || [])
    .map(t => `<span>${t}</span>`).join('');
  $('btn-scene-intro-ok').textContent = auto ? '继续行走' : '知道了';
  $('scene-intro-overlay').classList.remove('hidden');
  if (auto) {
    if (g) setTimeout(doPause, 0);
  }
}

function hideSceneIntro() {
  $('scene-intro-overlay').classList.add('hidden');
  if (game && game.running && game.pauseReason === 'scene-intro') {
    game.pauseReason = null;
    game.resume();
  }
}

function hideAllOverlays() {
  ['rpe-overlay', 'rest-overlay', 'pause-overlay', 'stop-overlay', 'scene-intro-overlay']
    .forEach(id => $(id).classList.add('hidden'));
  stopRestHrWatcher();
}

/* 手机竖屏时在游戏页显示横屏引导 */
function rotateHint() {
  const inGame = !$('screen-game').classList.contains('hidden');
  const portrait = window.innerHeight > window.innerWidth;
  $('rotate-overlay').classList.toggle('hidden', !(inGame && portrait && IS_MOBILE));
}
window.addEventListener('resize', rotateHint);

function startRestHrWatcher() {
  stopRestHrWatcher();
  restTimer = setInterval(() => {
    const bpm = hr.bpm;
    $('rest-hr').textContent = bpm || '--';
    const zone = $('rest-zone');
    if (!bpm || !game || !game.hrZone) { zone.textContent = ''; return; }
    if (bpm > game.hrZone.high) { zone.textContent = '仍偏高，再休息一会儿'; zone.style.color = '#b03a2e'; }
    else if (bpm >= game.hrZone.low) { zone.textContent = '已回到目标区间 ✓'; zone.style.color = '#3d7a6a'; }
    else { zone.textContent = '恢复良好'; zone.style.color = '#3d7a6a'; }
  }, 1000);
}
function stopRestHrWatcher() {
  if (restTimer) { clearInterval(restTimer); restTimer = null; }
}

/* ---------------- HUD ---------------- */

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateHud(h) {
  $('hud-phase-label').textContent = h.phaseLabel;
  $('hud-progress').style.width = (h.progress * 100).toFixed(1) + '%';
  $('hud-time').textContent = '剩余 ' + fmtTime(h.totalRemain);
  $('hud-steps').textContent = h.steps;
  $('hud-km').textContent = h.distanceKm;
  $('hud-stamps').textContent = h.stamps;
  $('hud-stamps-need').textContent = h.stampsNeed;
  $('hud-cadence').textContent = h.cadence;
  $('hud-tempo').textContent = h.tempo;
  const chip = $('hud-hr-chip');
  $('hud-hr').textContent = h.hr || '--';
  chip.classList.toggle('zone-high', !!h.hr && !h.hrManual && h.hrZone && h.hr > h.hrZone.high);
  chip.classList.toggle('zone-ok', !!h.hr && !h.hrManual && h.hrZone && h.hr >= h.hrZone.low && h.hr <= h.hrZone.high);
}

/* ---------------- 结算 ---------------- */

function handleSessionEnd(session, updatedJourney) {
  hideAllOverlays();
  $('btn-tap-step').classList.add('hidden');
  if (wakeLock) { try { wakeLock.release(); wakeLock = null; } catch (e) {} }
  store.addSession(session);
  store.saveJourney(updatedJourney);
  journey = updatedJourney;

  const done = session.endedBy === 'completed';
  $('summary-title').textContent = done ? '今日旅程完成！' : '今日旅程已记录';
  const st = store.streakInfo();
  $('summary-sub').textContent = done
    ? `连续打卡 ${st.current} 天 · 走的每一步，都算数。`
    : '完成的部分已记录，明天继续，山河都在。';

  // 印章主字：本次到访的最后一个景点
  const lastName = session.sceneNames[session.sceneNames.length - 1];
  const lastScene = SCENES.find(s => s.name === lastName) || SCENES[0];
  $('summary-stamp-ch').textContent = lastScene.ch;
  $('sum-stamps').textContent = session.stampsEarned;
  $('sum-steps').textContent = session.steps;
  $('sum-km').textContent = session.distanceKm.toFixed(2);
  $('sum-min').textContent = Math.max(1, Math.round(session.durationSec.total / 60));
  $('sum-kcal').textContent = Math.round(session.kcal);

  // 强度回顾
  const d = [];
  d.push(`平均步频 <b>${session.avgCadence}</b> 步/分（最高 ${session.maxCadence}）`);
  if (session.rpeSamples.length) {
    d.push('疲劳自评 RPE：' + session.rpeSamples.map(r =>
      `<b>${r.v}</b>（${Math.max(1, Math.round(r.t / 60))}分钟时）`).join('、'));
  } else {
    d.push('疲劳自评 RPE：本次未记录');
  }
  if (session.hrAvg) {
    const z = session.snapshot.hrZone;
    d.push(`平均心率 <b>${session.hrAvg}</b>，峰值 <b>${session.hrMax}</b> 次/分（目标 ${z.low}~${z.high}）`);
    if (session.autoPauses) d.push(`心率自动暂停 <b>${session.autoPauses}</b> 次`);
  } else {
    d.push('心率：本次未连接心率带（以疲劳感觉控制强度）');
  }
  if (session.snapshot.betaBlocker) d.push('服用β受体阻滞剂：已按 RPE 为主控强度');
  d.push('到访景点：' + session.sceneNames.join(' → '));
  $('summary-detail').innerHTML = d.map(x => `<div>· ${x}</div>`).join('');

  drawHrSpark(session);

  // 徽章
  const all = store.badges();
  $('summary-badges').innerHTML = all.map(b => `
    <div class="badge ${b.got ? '' : 'locked'}" ${b.got && !prevBadgeIds.includes(b.id) ? 'style="border-color:#c9971e;background:#fff6dd"' : ''}>
      <span class="icon">${b.icon}</span>
      <span><span class="name">${b.name}</span>${b.got && !prevBadgeIds.includes(b.id) ? ' <span style="color:#c9971e">新获得！</span>' : ''}
      <div class="desc">${b.desc}</div></span>
    </div>`).join('');

  showScreen('screen-summary');
}

function drawHrSpark(session) {
  const cv = $('hr-spark');
  const pts = session.hrSeries || [];
  if (pts.length < 3) { cv.classList.add('hidden'); return; }
  cv.classList.remove('hidden');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 60);
  const vmin = Math.min(...pts.map(p => p.v)) - 5;
  const vmax = Math.max(...pts.map(p => p.v), (session.snapshot.hrZone?.high || 0) + 5) + 5;
  const X = t => (t - t0) / (t1 - t0) * (W - 60) + 50;
  const Y = v => H - 18 - (v - vmin) / (vmax - vmin) * (H - 34);
  // 目标区间底色
  const z = session.snapshot.hrZone;
  if (z) {
    ctx.fillStyle = 'rgba(61,122,106,0.12)';
    ctx.fillRect(50, Y(z.high), W - 60, Y(z.low) - Y(z.high));
    ctx.strokeStyle = 'rgba(61,122,106,0.5)';
    ctx.setLineDash([4, 4]);
    for (const v of [z.low, z.high]) {
      ctx.beginPath(); ctx.moveTo(50, Y(v)); ctx.lineTo(W - 10, Y(v)); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // 曲线
  ctx.strokeStyle = '#b03a2e';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v)));
  ctx.stroke();
  // 轴
  ctx.fillStyle = '#5a6b7d';
  ctx.font = '13px system-ui';
  ctx.fillText(`${Math.round(vmax)}`, 8, Y(vmax) + 5);
  ctx.fillText(`${Math.round(vmin)}`, 8, Y(vmin) + 5);
  ctx.fillText('心率曲线（次/分）', 50, 14);
}

/* ---------------- 通关文牒 ---------------- */

function renderPassport() {
  const j = store.getJourney();
  $('passport-sub').textContent = `山河十二景 · 集章之旅${j.rounds > 0 ? ` · 已环游 ${j.rounds} 圈` : ''}`;
  const total = SCENES.length * CONFIG.game.stampCardNeed;
  $('journey-fill').style.width = Math.min(100, j.stampsTotal / total * 100) + '%';
  $('journey-text').textContent = `${j.stampsTotal} / ${total} 枚`;

  $('passport-grid').innerHTML = SCENES.map((s, i) => {
    const earned = j.rounds > 0 || i < j.sceneIndex;
    const current = i === j.sceneIndex;
    const cls = earned ? 'earned' : (current ? 'current' : 'locked');
    const stampInner = earned ? s.ch : (current ? `${j.stampsInScene}/${CONFIG.game.stampCardNeed}` : '🔒');
    const prog = current ? `<div class="scene-progress-text">集章进度 ${j.stampsInScene}/${CONFIG.game.stampCardNeed}</div>` : '';
    return `<div class="scene-card ${cls}">
      <div class="scene-name">${s.name}</div>
      <div class="scene-sub">${s.sub}</div>
      <div class="scene-stamp">${stampInner}</div>
      ${prog}
    </div>`;
  }).join('');
}

/* ---------------- 设置 ---------------- */

function renderSettings() {
  $('set-sound').checked = settings.sound;
  $('set-speech').checked = settings.speech;
  const cfg = settings.cfg || {};
  $('cfg-int-lo').value = CONFIG.medical.intensityLow;
  $('cfg-int-hi').value = CONFIG.medical.intensityHigh;
  $('cfg-rpe-int').value = CONFIG.medical.rpePromptIntervalSec;
  $('cfg-tempo').value = CONFIG.tempo.start;
  updateCfgHint();
}

function updateCfgHint() {
  const p = store.getProfile();
  const z = targetHrZone(p.age, p.restingHr);
  $('cfg-hint').textContent = `按当前档案（${p.age}岁，静息心率 ${p.restingHr}）：目标心率 ${z.low}~${z.high} 次/分。`;
}

function applyCfgOverrides() {
  const cfg = settings.cfg || {};
  if (cfg.intensityLow != null) CONFIG.medical.intensityLow = cfg.intensityLow;
  if (cfg.intensityHigh != null) CONFIG.medical.intensityHigh = cfg.intensityHigh;
  if (cfg.rpePromptIntervalSec != null) CONFIG.medical.rpePromptIntervalSec = cfg.rpePromptIntervalSec;
  if (cfg.tempoStart != null) CONFIG.tempo.start = cfg.tempoStart;
}

function saveCfgFromInputs() {
  settings.cfg = {
    intensityLow: clamp(parseFloat($('cfg-int-lo').value) || 0.4, 0.2, 0.7),
    intensityHigh: clamp(parseFloat($('cfg-int-hi').value) || 0.6, 0.3, 0.8),
    rpePromptIntervalSec: clamp(parseInt($('cfg-rpe-int').value, 10) || 300, 120, 600),
    tempoStart: clamp(parseInt($('cfg-tempo').value, 10) || 104, 80, 120),
  };
  applyCfgOverrides();
  store.saveSettings(settings);
  updateCfgHint();
}

/* ---------------- 工具 ---------------- */

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function cleanupBody() {
  stopSetupPreview();
  if (body) { body.stop(); body = null; bodyMode = null; }
  hr.clearManual();
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  // 主页
  $('btn-start').onclick = () => { renderSetup(); showScreen('screen-setup'); };
  $('btn-passport').onclick = () => { renderPassport(); showScreen('screen-passport'); };
  $('btn-settings').onclick = () => { renderSettings(); showScreen('screen-settings'); };

  // 准备页
  $('btn-cam').onclick = initCameraInSetup;
  $('in-age').oninput = updateHrZoneText;
  $('in-resthr').oninput = updateHrZoneText;
  $('ck-beta').onchange = updateHrZoneText;
  document.querySelectorAll('input[name="setting"]').forEach(r => {
    r.onchange = updateHrZoneText;
  });
  $('ck-demo').onchange = () => {
    const demo = $('ck-demo').checked;
    $('row-auto').classList.toggle('hidden', !demo);
    if (demo && bodyMode === 'camera') {
      if (confirm('切换到演示模式将关闭摄像头，确定吗？')) {
        cleanupBody(); updateCamStatus('未开启');
      } else { $('ck-demo').checked = false; $('row-auto').classList.add('hidden'); }
    }
  };
  $('btn-back-home').onclick = () => { cleanupBody(); renderHome(); showScreen('screen-home'); };
  $('btn-begin').onclick = startSession;

  // 心率带
  $('btn-hr').onclick = async () => {
    if (!HRMonitor.supported) {
      $('hr-status').textContent = '当前浏览器不支持蓝牙（建议 Chrome/Edge，或使用手动输入）';
      return;
    }
    $('hr-status').textContent = '请在弹出窗口中选择您的心率带…';
    const ok = await hr.connect();
    $('hr-status').textContent = ok ? `已连接 ${hr.deviceName} ✓` : '未连接';
  };
  hr.onUpdate = (bpm) => { if (game && game.running) { /* HUD 自动刷新 */ } };
  $('in-hr-manual').onchange = () => {
    const v = parseInt($('in-hr-manual').value, 10);
    if (v > 0) { hr.setManual(v); $('hr-status').textContent = `手动心率：${hr.bpm} 次/分`; }
  };

  // 游戏按钮
  $('btn-game-pause').onclick = () => {
    if (!game) return;
    game.pause('manual');
    $('pause-overlay').classList.remove('hidden');
  };
  $('btn-game-stop').onclick = () => {
    if (!game) return;
    game.pause('manual-stop');
    $('stop-overlay').classList.remove('hidden');
  };
  $('btn-pause-resume').onclick = () => { game && game.resume(); $('pause-overlay').classList.add('hidden'); };
  $('btn-pause-stop').onclick = () => {
    $('pause-overlay').classList.add('hidden');
    game && game.stop('user');
  };
  $('btn-stop-confirm').onclick = () => { $('stop-overlay').classList.add('hidden'); game && game.stop('user'); };
  $('btn-stop-cancel').onclick = () => {
    $('stop-overlay').classList.add('hidden');
    $('pause-overlay').classList.remove('hidden');
  };
  $('btn-rpe-quick').onclick = () => {
    if (!game || !game.running || game.paused) return;
    game.pause('rpe');
    $('rpe-overlay').classList.remove('hidden');
  };
  document.querySelectorAll('.rpe-btn').forEach(b => {
    b.onclick = () => {
      $('rpe-overlay').classList.add('hidden');
      game && game.answerRpe(parseInt(b.dataset.v, 10));
    };
  });
  $('btn-rest-resume').onclick = () => {
    $('rest-overlay').classList.add('hidden');
    stopRestHrWatcher();
    game && game.resume();
  };
  $('btn-rest-stop').onclick = () => {
    $('rest-overlay').classList.add('hidden');
    stopRestHrWatcher();
    game && game.stop('user');
  };

  // 结算
  $('btn-summary-home').onclick = () => {
    cleanupBody();
    renderHome();
    showScreen('screen-home');
  };
  $('btn-summary-again').onclick = () => { startSession(); };

  // 通关文牒
  $('btn-passport-back').onclick = () => { renderHome(); showScreen('screen-home'); };

  // 设置
  $('btn-settings-back').onclick = () => { renderHome(); showScreen('screen-home'); };
  $('set-sound').onchange = () => { settings.sound = $('set-sound').checked; store.saveSettings(settings); };
  $('set-speech').onchange = () => { settings.speech = $('set-speech').checked; store.saveSettings(settings); };
  ['cfg-int-lo', 'cfg-int-hi', 'cfg-rpe-int', 'cfg-tempo'].forEach(id => {
    $(id).onchange = saveCfgFromInputs;
  });
  $('btn-export-csv').onclick = () => {
    if (!store.getSessions().length) { alert('暂无训练记录'); return; }
    store.downloadFile(store.exportCSV(), `云游山河-训练记录-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  $('btn-export-json').onclick = () => {
    if (!store.getSessions().length) { alert('暂无训练记录'); return; }
    store.downloadFile(store.exportJSON(), `云游山河-完整数据-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  $('btn-clear').onclick = () => {
    if (confirm('确定清空全部本地数据（档案、训练记录、集章进度）？此操作不可恢复。')) {
      store.resetAll();
      location.reload();
    }
  };

  // 景点介绍卡
  $('btn-scene-intro-ok').onclick = hideSceneIntro;
  $('btn-scene-info').onclick = () => {
    if (!game || !game.running) return;
    const scene = SCENES[game.journey.sceneIndex];
    showSceneIntro(scene, false);
  };

  // 津发等研究设备：WebSocket 心率
  $('btn-hr-ws').onclick = () => {
    const url = $('in-hr-ws').value.trim();
    if (!url) { $('hr-status').textContent = '请先填写采集软件的 WebSocket 地址'; return; }
    const ok = hr.connectWS(url);
    if (ok) $('hr-status').textContent = '研究设备连接中…';
  };
  hr.onStatus = (s) => {
    if (s === 'connected') $('hr-status').textContent = `已连接 ${hr.deviceName} ✓`;
    else if (s === 'disconnected') $('hr-status').textContent = '设备已断开';
  };

  // 演示模式触屏踏步（手机演示）
  $('btn-tap-step').onclick = () => { if (body) body.tapStep(); };

  // 页面关闭时释放摄像头与屏幕常亮锁
  window.addEventListener('beforeunload', () => {
    if (body) body.stop();
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} }
  });
}

/* ---------------- 启动 ---------------- */

bind();
renderHome();
if (QUICK) console.log('[云游山河] 快速体验模式：热身20s / 主运动90s / 整理20s');
