/**
 * 主控制器：屏幕流转 + 事件接线
 * 主页 → 准备（安全确认/摄像头/心率带）→ 游戏（HUD/RPE/休息/暂停）
 *      → 结算（数据入库）→ 通关文牒 / 设置
 */
import { CONFIG } from './config.js';
import { endSessionNotice } from './session-safety.js';
import { PlanGateway, createDemoPlan, canStartPlan, checkPreflight } from './rehab-plan.js';
import { AudioCoach } from './audio.js';
import { HRMonitor } from './hr.js';
import { BodyInput } from './pose.js';
import { Game } from './game.js';
import { SCENES, preloadScenePhotosAround } from './scenes.js';
import * as store from './storage.js';
import { stampArtUrl, preloadSceneArt } from './art.js';

const $ = (id) => document.getElementById(id);
// 内联 Lucide 图标（index.html 顶部 sprite；ISC License）
const iconSvg = (name) => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const QUICK = new URLSearchParams(location.search).has('quick'); // ?quick=1 快速体验（演示/测试）
const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
// 微信内打开：XWeb/WKWebView 通常无法授权摄像头 → 引导到系统浏览器（?wechat=1 可强制触发，便于测试）
const IN_WECHAT = /MicroMessenger/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('wechat');

// 预加载第 1、2 站实景照片（其余按需；缺图自动回退程序化场景）
preloadScenePhotosAround(0);

// 提前拉取楷体子集 webfont：canvas 印章/景点字在字体就绪后即以楷体渲染，
// 就绪前自动回退系统字体（画面逐帧重绘，无需额外等待逻辑）
if (document.fonts?.load) {
  document.fonts.load('700 16px "LXGW WenKai GB Screen"', '云游山河康0');
}

/* ---------------- 全局状态 ---------------- */

let recordScope='demo', clinicalPlan=null, lastCompletedSession=null, pendingCompletion=null;
let starting=false, startAttempt=0, bodyInitGeneration=0;
const planGateway=new PlanGateway(); // Host integration supplies authenticated fetch/verification; no default endpoint.
let settings = store.getSettings();
const audio = new AudioCoach(settings);
const hr = new HRMonitor();
let body = null;            // BodyInput
let bodyMode = null;        // 'camera' | 'demo'
let game = null;
let journey = store.getJourney(recordScope);
let selectedMainSec = store.getProfile().mainSec || 1200;
let prevBadgeIds = [];      // 本次训练前已有的徽章（用于结算时标记新徽章）
let setupPreviewRaf = null;
let restTimer = null;
let wakeLock = null;       // 手机屏幕常亮锁


/* ---------------- 屏幕切换 ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showStampArt(id, scene, { gold = false, compact = false } = {}) {
  const img = document.createElement('img');
  img.src = stampArtUrl(scene.id, { gold, compact });
  img.alt = `${scene.name}${gold ? '金色' : ''}纪念章`;
  img.className = 'art-emblem';
  $(id).replaceChildren(img);
}

/* ---------------- 主页 ---------------- */

function renderHome() {
  const currentJourney = store.getJourney(recordScope);
  const sceneIndex = Number.isInteger(currentJourney.sceneIndex) && SCENES[currentJourney.sceneIndex] ? currentJourney.sceneIndex : 0;
  const scene = SCENES[sceneIndex];
  $('home-scene-photo').src = scene.photo;
  $('home-scene-photo').alt = `${scene.name}风景`;
  $('home-scene-name').textContent = scene.name;
  $('home-scene-verse').textContent = scene.sub;
  $('home-scene-index').textContent = `${String(sceneIndex + 1).padStart(2, '0')} / ${SCENES.length}`;
  $('home-scene-stamps').textContent = currentJourney.stampsInScene;
  showStampArt('home-scene-seal', scene, { compact: true });
  preloadSceneArt(scene.id);
  const st = store.participationInfo(recordScope);
  $('view-scope').value=recordScope;
  $('home-plan-state').textContent=recordScope==='demo'?'演示体验，不计入正式康复记录':clinicalPlan?'已接入计划，开始前仍需检查':'尚未关联可信康复计划';
  const hold=store.getHold(recordScope);
  $('home-hold').classList.toggle('hidden',!hold);
  $('home-hold').textContent=hold?'上次会话已停止或中断，不能自动继续。正式训练需康复团队复核；演示测试可重置演示状态。':'';
  $('btn-reset-demo-hold').classList.toggle('hidden',recordScope!=='demo'||!hold);
  $('stat-streak').textContent = st.current;
  $('stat-km').textContent = store.getJourney(recordScope).totalKm.toFixed(1);
  $('stat-stamps').textContent = store.getJourney(recordScope).stampsTotal;
  $('stat-sessions').textContent = st.totalSessions;
  const last = store.lastSessionDate(recordScope);
  const tips = [
    '建议穿着运动鞋，身前 2 米内留出活动空间。',
    '训练前避免空腹或饱腹，备好温水。',
    '如当日身体不适，休息也是康复的一部分。',
    '按个体计划运动；出现不适请停止并联系康复团队。',
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
  $('in-weight').value = p.weightKg || 70;
  $('ck-beta').checked = !!p.betaBlocker;
  $('ck-pacemaker').checked=!!p.pacemaker;
  $('ck-blocks').checked = !!p.strengthBlocks;
  const modeRadio = document.querySelector(`input[name="mode"][value="${p.mode}"]`);
  if (modeRadio) modeRadio.checked = true;
  selectedMainSec = p.mainSec || 1200;
  renderMainSecChoices();
  $('ck-demo').checked = true;
  for(const id of ['ck-safety','ck-no-hold','ck-space']) $(id).checked=false;
  document.querySelector(`input[name="session-kind"][value="${recordScope}"]`).checked=true;
  $('start-error').textContent='';
  $('ck-auto').checked = !!settings.autoWalkDemo;
  $('row-auto').classList.remove('hidden');
  updateHrZoneText();
  updateMonitorHint();
  updateCamStatus(bodyMode === 'camera' ? '摄像头已打开，请确认实际识别状态' : '模拟动作输入已选');
  updatePlanCard();
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
    weightKg: clamp(parseInt($('in-weight').value, 10) || 70, 35, 150),
    betaBlocker: $('ck-beta').checked,
    pacemaker:$('ck-pacemaker').checked,
    mode: document.querySelector('input[name="mode"]:checked').value,
    mainSec: selectedMainSec,
    strengthBlocks: $('ck-blocks').checked,   // 力量小站（间歇坐站），默认关闭
  };
}

function updateHrZoneText() {
  $('hr-zone-text').textContent=clinicalPlan?.hrZone?`${clinicalPlan.hrZone.low}–${clinicalPlan.hrZone.high} 次/分（来自已验证计划）`:'演示不生成目标心率';
  $('setting-hint').textContent='场景和运动负荷由计划确定；演示选项不构成康复处方。';
}
function isClinicalMode() { return document.querySelector('input[name="session-kind"]:checked')?.value==='clinical'; }
function updatePlanCard() {
  const clinical=isClinicalMode();
  $('plan-status').textContent=clinical?(clinicalPlan?'计划已验证':'尚未接入可信康复计划服务'):'演示计划 · 仅供功能体验';
  $('plan-detail').textContent=clinical?(clinicalPlan?`${clinicalPlan.id} · ${clinicalPlan.version}`:'不使用年龄公式生成处方，也不会把自我勾选视为医生签发。'):(QUICK?'快速演示：20秒热身 / 90秒主段 / 20秒整理':'演示参数用于软件体验，请勿据此安排患者训练。');
  $('btn-begin').disabled=starting || (clinical && !canStartPlan(clinicalPlan).ok);
  $('demo-options').classList.toggle('hidden',clinical);
  $('ck-demo').disabled=clinical;
  if(clinical) $('ck-demo').checked=false;
  $('row-auto').classList.toggle('hidden',clinical||!$('ck-demo').checked);
}

function getSettingMode() {
  const r = document.querySelector('input[name="setting"]:checked');
  return r ? r.value : 'home';
}

/* 准备页：当前强度监护方式提示（无设备安全模式的一等公民入口） */
function updateMonitorHint() {
  const state=hr.snapshot(clinicalPlan?.sampleMaxAgeMs||5000);
  const labels={idle:'未连接设备',connecting:'连接中',waiting:'已连接，等待有效数据',connected:'收到实时心率数据',disconnected:'连接已中断',stale:'数据已过期',manual:'手动脉搏，仅作单次记录',unsupported:'当前环境不支持此连接方式','contact-lost':'设备报告接触丢失','invalid-sample':'设备数据无效'};
  $('monitor-hint').textContent=(labels[state.status]||'未实时监测心率')+'。设备数据不代表医疗安全判断。';
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
  if(body && bodyMode===mode) return body;
  const generation=++bodyInitGeneration;
  if(body) body.stop(); body=null; bodyMode=null;
  const candidate=new BodyInput($('cam-video'),$('game-cam-preview'));
  body=candidate;
  try {await candidate.init({demo:mode==='demo',autoWalk:settings.autoWalkDemo});}
  catch(e) {candidate.stop();if(body===candidate){body=null;bodyMode=null;}throw e;}
  if(generation!==bodyInitGeneration || body!==candidate) { candidate.stop(); throw new Error('输入初始化已取消'); }
  bodyMode=mode; return candidate;
}

/* ---------------- 开始训练 ---------------- */

async function startSession() {
  if(starting || game?.running) return;
  const clinical=isClinicalMode(), scope=clinical?'clinical':'demo';
  $('start-error').textContent='';
  if(store.getHold(scope)) { $('start-error').textContent='上次会话仍有停止或中断标记。请返回首页查看；正式训练需要复核。'; return; }
  if(!['ck-safety','ck-no-hold','ck-space'].every(id=>$(id).checked)) { $('start-error').textContent='请先逐项确认今日状态与活动环境；如有不适，不要开始。'; return; }
  const profile=currentProfileFromForm();
  let plan;
  try { plan=clinical?clinicalPlan:createDemoPlan({quick:QUICK,mainSec:selectedMainSec,mode:profile.mode,strengthBlocks:profile.strengthBlocks}); }
  catch(e) { $('start-error').textContent=e.message; return; }
  if(!canStartPlan(plan).ok) { $('start-error').textContent='缺少已验证的有效康复计划，不能开始正式训练。'; return; }
  if(typeof crypto.randomUUID!=='function') { $('start-error').textContent='当前环境无法创建可靠会话标识，请使用受支持的HTTPS环境。'; return; }
  const attempt=++startAttempt;
  starting=true; updatePlanCard();
  try {
    const wantDemo=!clinical && $('ck-demo').checked;
    const input=await ensureBody(wantDemo?'demo':'camera');
    if(attempt!==startAttempt || $('screen-setup').classList.contains('hidden') || document.hidden) {cleanupBody();return;}
    const bodyState=input.update(performance.now());
    const checks=checkPreflight({symptomFree:$('ck-safety').checked,notOnHold:$('ck-no-hold').checked,spaceReady:$('ck-space').checked,plan,hrReady:hr.snapshot(plan.sampleMaxAgeMs).ready,bodyReady:bodyState.ok});
    if(!checks.ok) { $('start-error').textContent=checks.errors.join('；'); if(bodyMode==='camera') startSetupPreview(); return; }
    const sessionId=crypto.randomUUID();
    const marker=store.beginSession({sessionId,planId:plan.id,planVersion:plan.version},scope);
    if(!marker.ok) { $('start-error').textContent=marker.error; return; }
    recordScope=scope;
    if(scope==='demo') store.saveProfile(profile,'demo');
    settings.autoWalkDemo=wantDemo && $('ck-auto').checked; store.saveSettings(settings);
    if(bodyMode==='demo') body.autoWalk=settings.autoWalkDemo;
    audio.ensure(); audio.resumeSessionAudio(); hideAllOverlays();
    stopSetupPreview(); journey=store.getJourney(scope); prevBadgeIds=store.badges(scope).filter(b=>b.got).map(b=>b.id);
    rotateDismissed=true;
    showScreen('screen-game'); syncSoundBtn();
    $('session-mode-label').textContent=scope==='demo'?'演示体验 · 不用于正式康复记录':`按计划执行 · ${plan.version}`;
    $('btn-symptom-stop').disabled=false; $('btn-symptom-stop').textContent='不舒服，立即停止';
    body.setPointerTarget($('game-canvas'));
    $('game-cam-preview').classList.toggle('hidden',bodyMode!=='camera');
    const showTap=bodyMode==='demo' && IS_MOBILE;
    $('btn-tap-step').classList.toggle('hidden',!showTap);
    document.querySelector('.game-wrap').classList.toggle('has-tap',showTap);
    const effectiveProfile=clinical?{mode:plan.mode,age:null,restingHr:null,weightKg:null,betaBlocker:null,pacemaker:null}:profile;
    game=new Game({canvas:$('game-canvas'),body,hr,audio,profile:effectiveProfile,journey,settings,onEvent:onGameEvent,onHud:updateHud});
    if(!game.start(plan,{sessionId,inputSource:bodyMode==='demo'?'simulated':clinical?'camera':'camera-demo'})) throw new Error('计划验证失败');
    if(IS_MOBILE && navigator.wakeLock) {
      try { const lock=await navigator.wakeLock.request('screen'); if(attempt!==startAttempt||!game?.running||document.hidden) await lock.release(); else wakeLock=lock; } catch {}
    }
    rotateHint();
  } catch(e) { $('start-error').textContent='无法开始：'+(e.message||'请检查输入状态'); if(game?.running) game.safetyStop('startup-error'); else showScreen('screen-setup'); }
  finally { starting=false; updatePlanCard(); }
}

function showResumeReview() {
  if(!game?.running || game.safety.terminal) return;
  hideAllOverlays();
  for(const id of ['resume-symptom-free','resume-talk','resume-phone']) $(id).checked=false;
  $('resume-rpe').value=''; $('resume-error').textContent='';
  const lost=(game.monitor==='hr'||game.plan.requiredHr)&&!hr.snapshot(game.plan.sampleMaxAgeMs).ready;
  $('resume-phone-row').classList.toggle('hidden',!(lost&&game.plan.allowHrFallback));
  $('resume-overlay').classList.remove('hidden');
}
function confirmResume() {
  const raw=$('resume-rpe').value;
  const ok=game?.resume({reviewed:true,symptomFree:$('resume-symptom-free').checked,talkComfortable:$('resume-talk').checked,rpe:raw===''?NaN:Number(raw),usePhone:$('resume-phone').checked});
  if(ok) { hideAllOverlays(); audio.speak('已完成检查，继续按原计划进行。',true); }
  else $('resume-error').textContent='尚未满足继续条件。请完成自评并确认设备、动作输入及计划有效；如有不适，请立即停止。';
}
function showSafetyStop(reason) {
  hideAllOverlays();
  const result=store.lockSafety({sessionId:game.sessionId,reason},game.plan.scope);
  $('safety-reason').textContent=reason==='symptom'?'你报告了不适，本次会话不可恢复。':'计划或必要输入触发了停止条件，本次会话不可恢复。';
  $('safety-save-state').textContent=result.ok?'停止状态已保存在本机。未向医疗团队发送通知。':'停止状态写入失败；开始时的会话标记将阻止自动继续。请联系康复团队。';
  $('safety-overlay').classList.remove('hidden');
  $('btn-symptom-stop').disabled=true; $('btn-symptom-stop').textContent='已停止 · 本次不可恢复';
  audio.speak('本次运动已停止。不要继续。如有持续胸痛、严重气短或晕厥，请及时求助。',true);
}

/* ---------------- 游戏事件 ---------------- */

/* RPE 自评弹窗（定时询问与 HUD 快捷按钮共用）：RPE 主控时附说话测试提示 */
function openRpeDialog() {
  if(!game?.running || game.safety.terminal) return;
  $('rpe-talktest').classList.remove('hidden'); $('rpe-overlay').classList.remove('hidden');
  audio.speak('请按实际感觉选择疲劳程度。如果不舒服，请立即停止。',true);
}

function onGameEvent(ev) {
  switch (ev.type) {
    case 'rpe':
      openRpeDialog();
      break;
    case 'scene-intro':
      showSceneIntro(ev.scene, ev.auto);
      break;
    case 'input-pause': {
      if(game?.safety.terminal) break;
      hideAllOverlays();
      const labels={'device-lost':'实时数据已中断、过期或来源改变。','pose-lost':'动作识别失效，请检查手机与入镜位置。','rpe-hard':'你报告了明显疲劳。','background':'页面曾切到后台。','runtime-gap':'运行发生中断，计时已暂停。','clock-error':'检测到时钟异常。'};
      $('rest-reason').textContent=(labels[ev.reason]||'训练已暂停。')+' 继续前需要重新检查。';
      $('rest-overlay').classList.remove('hidden'); startRestHrWatcher(); break;
    }
    case 'safety-stop': showSafetyStop(ev.reason); break;
    case 'end':
      handleSessionEnd(ev.session, ev.journey);
      break;
  }
}

/* ---------------- 景点介绍卡 ---------------- */

function showSceneIntro(scene, auto = true) {
  if (!scene || game?.safety.terminal) return;
  // 开场介绍的 pause 在 game.start() 同步执行期内调用会失效，延后一帧
  const g = game;
  const doPause=()=>{if(g===game && g?.running && !g.safety.terminal) g.pause('scene-intro');};
  $('scene-intro-img').src = scene.photo;
  $('scene-intro-img').onerror = function () { this.style.display = 'none'; };
  $('scene-intro-img').style.display = '';
  showStampArt('scene-intro-ch', scene, { compact: true });
  $('scene-intro-name').textContent = scene.name;
  $('scene-intro-sub').textContent = scene.sub;
  $('scene-intro-text').textContent = scene.intro || '';
  $('scene-intro-tips').innerHTML = (scene.tips || [])
    .map(t => `<span>${t}</span>`).join('');
  $('btn-scene-intro-ok').textContent = auto ? '继续行走' : '知道了';
  $('scene-intro-overlay').classList.remove('hidden');
  doPause();
}

function hideSceneIntro() {
  $('scene-intro-overlay').classList.add('hidden');
  if(game?.running) game.resume({release:'scene-intro'});
}
function hideAllOverlays() {
  ['rpe-overlay','rest-overlay','pause-overlay','stop-overlay','scene-intro-overlay','resume-overlay','safety-overlay','rotate-overlay'].forEach(id=>$(id).classList.add('hidden'));
  stopRestHrWatcher();
}

/* 手机竖屏时在游戏页显示横屏引导（患者可选择竖屏继续，选择后本次不再打扰） */
let rotateDismissed = false;
function rotateHint() {
  const inGame = !$('screen-game').classList.contains('hidden');
  const portrait = window.innerHeight > window.innerWidth;
  const show = inGame && portrait && IS_MOBILE && !rotateDismissed;
  $('rotate-overlay').classList.toggle('hidden', !show);
}
window.addEventListener('resize', rotateHint);

function startRestHrWatcher() {
  stopRestHrWatcher();
  restTimer=setInterval(()=>{
    const state=hr.snapshot(game?.plan.sampleMaxAgeMs||5000);
    $('rest-hr').textContent=state.bpm??'--';
    $('rest-zone').textContent=state.ready?'当前读数，不等同于可以恢复':state.source==='manual'?'单次手动记录':'未收到有效实时数据';
  },500);
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
  // 力量小站：显示起坐数与倒计时，并提供跳过按钮（安全通道）
  const blk = h.block;
  $('hud-block').classList.toggle('hidden', !blk);
  $('btn-block-skip').classList.toggle('hidden', !blk);
  if (blk) {
    $('hud-block-reps').textContent = blk.reps;
    $('hud-block-time').textContent = blk.remain;
  }
  const chip = $('hud-hr-chip');
  $('hud-hr').textContent=(h.hrManual&&h.hr?`手动 ${h.hr}`:h.hr)??(h.hrStatus==='stale'?'数据过期':'未监测心率');
  chip.title=h.hrManual?'手动脉搏，不是实时监测':h.hr?'当前设备读数，不能据此判断医疗安全':'无有效实时心率';
  chip.classList.remove('zone-ok');
  chip.classList.toggle('zone-high',!!h.hr && !!game?.plan.hrStopAbove && h.hr>game.plan.hrStopAbove);
}

/* ---------------- 结算 ---------------- */

function handleSessionEnd(session, updatedJourney) {
  hideAllOverlays();
  $('btn-tap-step').classList.add('hidden');
  document.querySelector('.game-wrap').classList.remove('has-tap');
  if (wakeLock) { try { wakeLock.release(); wakeLock = null; } catch (e) {} }
  recordScope=session.dataScope; lastCompletedSession=session; pendingCompletion={session,journey:updatedJourney};
  const saved=store.commitSession(session,updatedJourney,recordScope);
  $('btn-retry-save').classList.toggle('hidden',saved.ok);
  $('summary-save-state').classList.toggle('save-error',!saved.ok);
  $('summary-save-state').textContent=saved.ok?(saved.warning||'已保存在本机，尚未同步到医疗平台。'):saved.error;
  $('post-symptom-free').checked=false;
  $('btn-summary-again').disabled=!!store.getHold(recordScope);
  journey = updatedJourney;
  cleanupBody();hr.disconnect();

  const done = session.endedBy === 'completed';
  const safetyEnded=session.endedBy==='safety';
  if(done && saved.ok && !safetyEnded) {audio.resumeSessionAudio();audio.gong();}
  audio.speak(endSessionNotice(session,saved.ok),true);
  $('summary-title').textContent=safetyEnded?'本次已因停止条件结束':saved.ok?(session.dataScope==='demo'?'演示旅程已记录':'本次旅程已记录'):'本次结果尚未保存';
  // 今日称号（趣味反馈：按完成度与出勤给称号，与运动强度无关，不诱导加练）
  const fullScene = (session.scenesCompleted > 0) || session.stampsEarned >= CONFIG.game.stampCardNeed;
  $('sum-award').innerHTML = safetyEnded?iconSvg('i-leaf')+'<span>适时停止，照顾自己</span>':!saved.ok?'<span>结果待保存</span>':done
    ? (fullScene ? iconSvg('i-trophy') + '<span>山河行者 · 集齐一整站</span>' : iconSvg('i-footprints') + '<span>健步旅人</span>')
    : (fullScene ? iconSvg('i-trophy') + '<span>山河行者 · 集齐一整站</span>'
      : session.steps >= 300 ? iconSvg('i-leaf') + '<span>小憩游人 · 明天继续</span>' : iconSvg('i-sprout') + '<span>明日再会</span>');
  const st = store.participationInfo(recordScope);
  $('summary-sub').textContent=session.dataScope==='demo'?'演示数据单独保存，不计入正式康复记录。':safetyEnded?'本次会话不可恢复，请联系康复团队复核。':'按计划完成或适时休息，都值得如实记录。';

  // 印章主字：本次到访的最后一个景点
  const lastName = session.sceneNames[session.sceneNames.length - 1];
  const lastScene = SCENES.find(s => s.name === lastName) || SCENES[0];
  // 最后到访景点未必是本次集齐的景点，结算封面不据此授予金色章。
  showStampArt('summary-stamp-ch', lastScene);
  $('sum-stamps').textContent = session.stampsEarned;
  $('sum-steps').textContent = session.steps;
  $('sum-km').textContent = session.distanceKm.toFixed(2);
  $('sum-min').textContent = fmtTime(session.durationSec.total);
  $('sum-kcal').textContent=Number.isFinite(session.kcal)?Math.round(session.kcal):'—';

  // 强度回顾
  const d = [];
  d.push(session.samples?.length?`有效样本平均步频 <b>${session.avgCadence}</b> 步/分（最高 ${session.maxCadence}）`:'步频采样不足，不计算均值');
  if (session.rpeSamples.length) {
    d.push('疲劳自评 RPE：' + session.rpeSamples.map(r =>
      `<b>${r.v}</b>（开始后${Math.round(r.t)}秒）`).join('、'));
  } else {
    d.push('疲劳自评 RPE：本次未记录');
  }
  if (session.hrAvg) {
    d.push(`有效样本平均心率 <b>${session.hrAvg}</b>，最高 <b>${session.hrMax}</b> 次/分（非医疗安全结论）`);
    if (session.autoPauses) d.push(`心率自动暂停 <b>${session.autoPauses}</b> 次`);
  } else {
    const monText = {
      rpe: '本次未实时监测心率；请结合已批准计划与实际症状',
      manual: '手动脉搏模式 —— 以疲劳自评（RPE）为主控',
    };
    d.push('心率：' + (monText[session.monitor] || '本次未连接心率带（以疲劳感觉控制强度）'));
  }
  d.push('自评量表：项目0–10（非Borg 6–20换算）');
  d.push('计划版本：'+String(session.planVersion).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  if (session.strengthBlocks) {
    d.push(`力量小站：完成 <b>${session.blocksRun || 0}</b> 组，共 <b>${session.sitStandReps || 0}</b> 次坐站起坐`);
  }
  d.push('到访景点：' + session.sceneNames.join(' → '));
  $('summary-detail').innerHTML = d.map(x => `<div>· ${x}</div>`).join('');

  drawHrSpark(session);

  // 徽章
  const all = store.badges(recordScope);
  $('summary-badges').innerHTML = all.map(b => `
    <div class="badge ${b.got ? '' : 'locked'}" ${b.got && !prevBadgeIds.includes(b.id) ? 'style="border-color:#c9971e;background:#fff6dd"' : ''}>
      <span class="badge-ico">${iconSvg(b.icon)}</span>
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
  const j = store.getJourney(recordScope);
  $('passport-sub').textContent = `山河十三景 · 集章之旅${j.rounds > 0 ? ` · 已环游 ${j.rounds} 圈` : ''}`;
  const total = SCENES.length * CONFIG.game.stampCardNeed;
  $('journey-fill').style.width = Math.min(100, j.stampsTotal / total * 100) + '%';
  $('journey-text').textContent = `${j.stampsTotal} / ${total} 枚`;

  $('passport-grid').innerHTML = SCENES.map((s, i) => {
    const earned = j.rounds > 0 || i < j.sceneIndex;
    const current = i === j.sceneIndex;
    const cls = earned ? 'earned' : (current ? 'current' : 'locked');
    const stampInner = `<img class="art-emblem" src="${stampArtUrl(s.id, { gold: earned })}" alt="${s.name}${earned ? '已获得金色纪念章' : current ? '当前纪念章' : '待收集纪念章'}" loading="lazy">`;
    const prog = current ? `<div class="scene-progress-text">集章进度 ${j.stampsInScene}/${CONFIG.game.stampCardNeed}</div>` : '';
    return `<div class="scene-card ${cls}" data-ch="${s.ch}">
      <div class="passport-photo-wrap"><img class="passport-photo" src="${s.photo}" alt="${s.name}风景" loading="lazy"><span class="passport-number">${String(i + 1).padStart(2, '0')}</span></div>
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
  fillVoiceSelect();

}

/* 教练声音下拉：自动 + 设备可用中文语音按性别分组（男女患者可选） */
function fillVoiceSelect() {
  const sel = $('set-voice');
  const voices = audio.listZhVoices();
  const opts = ['<option value="">自动（推荐）</option>'];
  if (!voices.length) {
    opts.push('<option value="" disabled>正在获取设备声音列表…</option>');
  } else {
    const byGender = { female: '女声教练', male: '男声教练', unknown: '其他中文声音' };
    for (const g of ['female', 'male', 'unknown']) {
      const group = voices.filter(v => v.gender === g);
      if (!group.length) continue;
      opts.push(`<optgroup label="${byGender[g]}">` + group.map(v =>
        `<option value="${v.uri}">${v.name}</option>`).join('') + '</optgroup>');
    }
  }
  sel.innerHTML = opts.join('');
  sel.value = settings.voiceURI || '';
  if (!sel.value && sel.selectedIndex === -1) sel.selectedIndex = 0;
}

/* ---------------- 游戏内声音开关 ---------------- */

function syncSoundBtn() {
  const on = settings.sound || settings.speech;
  $('btn-game-sound').innerHTML = iconSvg(on ? 'i-volume-2' : 'i-volume-x');
  $('btn-game-sound').classList.toggle('muted', !on);
  $('btn-game-sound').title = on ? '声音：开（点击静音）' : '声音：关（点击开启）';
}

/* ---------------- 工具 ---------------- */

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function cleanupBody() {
  ++bodyInitGeneration;
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
  $('ck-beta').onchange = () => { updateHrZoneText(); updateMonitorHint(); };
  document.querySelectorAll('input[name="setting"]').forEach(r => {
    r.onchange = updateHrZoneText;
  });
  $('ck-demo').onchange = () => {
    ++startAttempt;
    const demo = $('ck-demo').checked;
    $('row-auto').classList.toggle('hidden', !demo);
    if (demo && bodyMode === 'camera') {
      if (confirm('切换到演示模式将关闭摄像头，确定吗？')) {
        cleanupBody(); updateCamStatus('未开启');
      } else { $('ck-demo').checked = false; $('row-auto').classList.add('hidden'); }
    }
  };
  $('btn-back-home').onclick = () => { ++startAttempt; cleanupBody(); renderHome(); showScreen('screen-home'); };
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
    updateMonitorHint();
  };
  $('in-hr-manual').onchange = () => {
    const v = parseInt($('in-hr-manual').value, 10);
    if (v > 0) { hr.setManual(v); $('hr-status').textContent = `手动心率：${hr.bpm} 次/分`; }
    updateMonitorHint();
  };

  // 游戏按钮
  $('btn-game-pause').onclick = () => {
    if (!game?.running || game.safety.terminal) return;
    audio.pauseCue();
    audio.speak('已暂停，想继续时随时回来。');
    game.pause('manual');
    $('pause-overlay').classList.remove('hidden');
  };
  $('btn-game-stop').onclick = () => {
    if (!game?.running || game.safety.terminal) return;
    game.pause('manual-stop');
    $('stop-overlay').classList.remove('hidden');
  };
  $('btn-pause-resume').onclick=showResumeReview;
  $('btn-pause-stop').onclick = () => {
    $('pause-overlay').classList.add('hidden');
    game && game.stop('user');
  };
  $('btn-stop-confirm').onclick = () => {
    $('stop-overlay').classList.add('hidden');
    audio.speak('好的，本次训练到此结束。');
    game && game.stop('user');
  };
  $('btn-stop-cancel').onclick = () => {
    $('stop-overlay').classList.add('hidden');
    $('pause-overlay').classList.remove('hidden');
  };
  $('btn-rpe-quick').onclick = () => {
    if (!game || !game.running || game.paused) return;
    game.pause('rpe');
    openRpeDialog();
  };
  document.querySelectorAll('.rpe-btn').forEach(b => {
    b.onclick = () => {
      $('rpe-overlay').classList.add('hidden');
      game && game.answerRpe(parseInt(b.dataset.v, 10));
    };
  });
  // 力量小站跳过按钮（安全通道：不舒服随时跳过回到踏步）
  $('btn-block-skip').onclick = () => {
    if (!game || !game.running) return;
    game.skipBlock();   // 内部已带跳过语音与事件记录
  };
  $('btn-rest-resume').onclick=showResumeReview;
  $('btn-rest-stop').onclick = () => {
    $('rest-overlay').classList.add('hidden');
    stopRestHrWatcher();
    game && game.stop('user');
  };

  // 结算
  $('btn-summary-home').onclick = () => {
    if(lastCompletedSession) store.finalizeSession(lastCompletedSession.sessionId,lastCompletedSession.dataScope);
    cleanupBody();
    renderHome();
    showScreen('screen-home');
  };
  $('btn-summary-again').onclick=()=>{if(!lastCompletedSession||!store.finalizeSession(lastCompletedSession.sessionId,lastCompletedSession.dataScope).ok)return;cleanupBody();renderSetup();showScreen('screen-setup');};
  $('btn-retry-save').onclick=()=>{if(pendingCompletion)handleSessionEnd(pendingCompletion.session,pendingCompletion.journey);};

  // 通关文牒
  $('btn-passport-back').onclick = () => { renderHome(); showScreen('screen-home'); };

  // 设置
  $('btn-settings-back').onclick = () => { renderHome(); showScreen('screen-home'); };
  $('set-sound').onchange = () => { settings.sound = $('set-sound').checked; store.saveSettings(settings); syncSoundBtn(); };
  $('set-speech').onchange = () => { settings.speech = $('set-speech').checked; store.saveSettings(settings); syncSoundBtn(); };
  $('set-voice').onchange = () => {
    const uri = $('set-voice').value;
    settings.voiceURI = uri || null;
    const chosen = uri ? audio.listZhVoices().find(v => v.uri === uri) : null;
    settings.voiceMode = chosen ? chosen.gender : 'auto';
    store.saveSettings(settings);
    audio.refreshVoice();
  };
  $('btn-voice-test').onclick = () => {
    audio.ensure();
    audio.speak('您好，我是您的康复教练。今天也一起，稳稳地走。', true);
  };
  // 音效试听：依次播放 摘取(泡泡)→连击2/3/4(变调上行)→里程碑→末印，先给素材加载留半秒
  $('btn-sfx-test').onclick = () => {
    audio.ensure();
    audio.speak('现在试听新音效：摘取、连击、里程碑、末印预告。', true);
    const seq = [
      [900, () => audio.catchItem()],
      [1400, () => audio.combo(2)],
      [1800, () => audio.combo(3)],
      [2200, () => audio.combo(4)],
      [2700, () => audio.milestone()],
      [3300, () => audio.finalStamp()],
    ];
    const revision=audio.revision;
    seq.forEach(([t,fn])=>setTimeout(()=>{if(audio.revision===revision)fn();},t));
  };
  $('btn-export-csv').onclick = () => {
    if (!store.getSessions(recordScope).length) { alert('暂无训练记录'); return; }
    store.downloadFile(store.exportCSV(recordScope), `云游山河-训练记录-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  $('btn-export-json').onclick = () => {
    if (!store.getSessions(recordScope).length) { alert('暂无训练记录'); return; }
    store.downloadFile(store.exportJSON(recordScope), `云游山河-完整数据-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  $('btn-export-legacy').onclick=()=>store.downloadFile(store.exportLegacyJSON(),'云游山河-旧版未核实记录.json','application/json');
  const resetDemo=()=>{if(recordScope!=='demo'){alert('正式训练停止状态需由康复团队复核。');return;} const result=store.clearDemoHold();if(!result.ok){alert(result.error);return;}renderHome();showScreen('screen-home');};
  $('btn-clear').onclick=resetDemo;
  $('btn-reset-demo-hold').onclick=resetDemo;
  $('view-scope').onchange=()=>{recordScope=$('view-scope').value;renderHome();};
  document.querySelectorAll('input[name="session-kind"]').forEach(input=>input.onchange=async()=>{
    ++startAttempt;
    if(isClinicalMode()) { const result=await planGateway.load(); clinicalPlan=result.ok?result.plan:null; }
    else $('ck-demo').checked=true;
    $('start-error').textContent='';updatePlanCard();
  });
  $('btn-symptom-stop').onclick=()=>game?.safetyStop('symptom');
  $('btn-safety-finish').onclick=()=>game?.stop('safety');
  $('btn-resume-confirm').onclick=confirmResume;
  $('btn-resume-end').onclick=()=>game?.stop('user');
  $('post-symptom-free').onchange=()=>{
    if(lastCompletedSession && $('post-symptom-free').checked) {
      const result=store.savePostCheck(lastCompletedSession.sessionId,true,lastCompletedSession.dataScope);
      $('summary-save-state').textContent=result.ok?'结束后反馈已保存在本机。离开此页后完成本次记录。':result.error;
      if(!result.ok) $('post-symptom-free').checked=false;
      $('btn-summary-again').disabled=!result.ok || store.getHold(lastCompletedSession.dataScope)?.state==='SAFETY_STOPPED';
    }
  };
  $('btn-post-symptom').onclick=()=>{
    if(!lastCompletedSession) return;
    $('post-symptom-free').checked=false;
    const hold=store.lockSafety({sessionId:lastCompletedSession.sessionId,reason:'post-session-symptom'},lastCompletedSession.dataScope);
    store.savePostCheck(lastCompletedSession.sessionId,false,lastCompletedSession.dataScope);
    $('summary-save-state').textContent='请勿继续训练，联系康复团队；持续胸痛、严重气短或晕厥等情况请及时拨打120。'+(hold.ok?'已保存停止复核状态。':'状态写入失败。');
    $('btn-summary-again').disabled=true;
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
    updateMonitorHint();
    if(game?.running && !game.safety.terminal) game.checkInputs();
  };

  // 演示模式触屏踏步（手机演示）
  $('btn-tap-step').onclick = () => { if (body) body.tapStep(); };

  // 竖屏引导"就按竖屏继续"：本次训练内不再弹出
  $('btn-rotate-continue').onclick = () => {
    rotateDismissed = true;
    $('rotate-overlay').classList.add('hidden');
  };

  // 微信引导"先体验"：进入准备页并预勾演示模式+自动行走（无需摄像头即可完整体验）
  $('btn-wechat-demo').onclick = () => {
    sessionStorage.setItem('yysn_wechat_hint_closed', '1');
    $('wechat-overlay').classList.add('hidden');
    $('btn-start').onclick();
    $('ck-demo').checked = true;
    $('row-auto').classList.remove('hidden');
    $('ck-auto').checked = true;
  };

  // 游戏内声音开关（音效 + 语音一体切换）
  $('btn-game-sound').onclick = () => {
    const on = !(settings.sound || settings.speech);
    settings.sound = on;
    settings.speech = on;
    store.saveSettings(settings);
    syncSoundBtn();
    if (on && !game?.safety.terminal) {
      audio.ensure();
      audio.resumeCue();
      audio.speak('声音已开启。', true);
    } else {
      try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    }
  };

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) {
      ++startAttempt;
      if(game?.running && !game.safety.terminal) {game.pause('background');onGameEvent({type:'input-pause',reason:'background'});}
      if(wakeLock){try{wakeLock.release();}catch{}wakeLock=null;}
    }
  });
  setInterval(()=>{updateMonitorHint();if(game?.running)game.checkInputs();},500);

  // 页面关闭时释放摄像头与屏幕常亮锁
  window.addEventListener('beforeunload', () => {
    if (body) body.stop();
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} }
  });
}

/* ---------------- 启动 ---------------- */

bind();
renderHome();
audio.bindUnlock();   // 手机端：首次触摸即解锁音效与语音
if (QUICK) console.log('[云游山河] 快速体验模式：热身20s / 主运动90s / 整理20s');
// 语音列表异步就绪时，若设置页开着则刷新"教练声音"下拉
audio.onVoicesReady = () => {
  if (!$('screen-settings').classList.contains('hidden')) fillVoiceSelect();
};

// 微信内打开引导：每次会话只提示一次；可选择先以演示模式体验
if (IN_WECHAT && !sessionStorage.getItem('yysn_wechat_hint_closed')) {
  $('wechat-overlay').classList.remove('hidden');
}
