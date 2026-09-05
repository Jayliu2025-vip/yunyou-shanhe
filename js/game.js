/**
 * 游戏引擎：云游山河
 * - 三段式课程：热身 → 主运动 → 整理放松（时长见 config.session）
 * - 原地踏步推进风景（节拍器 + 脚印引导），抬手摘取印章与吉物
 * - 自适应强度：RPE 反馈调节目标步频；心率超限自动暂停
 * - 集章系统：每景点集齐 12 枚印章 → 盖章仪式 → 解锁下一景点
 */
import { CONFIG, targetHrZone } from './config.js';
import { SCENES, PXKM, drawWorld, HEALTH_TIPS } from './scenes.js';

const G = CONFIG.game;
const T = CONFIG.tempo;
const FONT_KAI = '"STKaiti","KaiTi","SimSun",serif';

const ENCOURAGEMENTS = [
  '走得很好，继续保持！', '山河正美，脚步正稳！', '很棒，就这样不紧不慢地走。',
  '呼吸顺畅，步履从容，真好！', '今日份的健康，正在稳稳积累！',
];

export class Game {
  constructor({ canvas, body, hr, audio, profile, journey, settings, onEvent, onHud }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.body = body;
    this.hr = hr;
    this.audio = audio;
    this.profile = profile;
    this.journey = journey;
    this.settings = settings;
    this.onEvent = onEvent || (() => {});
    this.onHud = onHud || (() => {});

    this.running = false;
    this.paused = false;
    this.pauseReason = null;
    this.simTime = 0;          // 训练用时（暂停不计）
    this._raf = null;
    this._lastFrame = 0;

    this.reset();
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
  }

  reset() {
    this.phase = 'warmup';
    this.phaseElapsed = 0;
    this.phaseDur = 0;
    this.tempo = T.start;
    this.beatAcc = 0;
    this.beatStrong = true;
    this.beatPhase = 0;
    this.visDist = 0;          // 视觉里程（公里）
    this.lastSteps = 0;
    this.stepsThisSession = 0;
    this.dispCadence = 0;
    this.items = [];
    this.effects = [];
    this.stampTimer = 6;
    this.bonusTimer = 5;
    this.syncTime = 0;
    this.syncFlashT = 0;
    this.celebrate = null;     // {until, scene, startedAt}
    this.transition = null;    // {from, to, startedAt}
    this.phaseTitle = null;    // {text, sub, until}
    this.rpeNextAt = 0;
    this.rpeSamples = [];
    this.samples = [];         // 每5秒采样
    this.sampleAcc = 0;
    this.hrSeries = [];
    this.hrSampleAcc = 0;
    this.hrOverSec = 0;
    this.autoPauses = 0;
    this.events = [];
    this.noBodySince = null;
    this.lowCadenceSince = null;
    this.encourageAt = 45;
    this.sceneNames = [];
    this.stampsEarned = 0;
    this.itemsCaught = 0;
    this.sessionKm = 0;
  }

  /* ---------------- 生命周期 ---------------- */

  start(plan) {
    this.reset();
    this.plan = plan;
    this.hrZone = plan.hrZone;
    // 院内监护模式：更快的超限响应与更频繁的 RPE 询问
    this.hrOverLimitSec = plan.hrOverLimitSec ?? CONFIG.medical.hrOverLimitPauseSec;
    this.rpeInterval = plan.rpePromptIntervalSec ?? CONFIG.medical.rpePromptIntervalSec;
    this.phase = 'warmup';
    this.phaseDur = plan.warmupSec;
    this.tempo = T.warmup;
    this.rpeNextAt = plan.warmupSec + this.rpeInterval;
    this.tipToast = null;       // 整理阶段健康小知识
    this.tipNextAt = Infinity;
    this.tipIdx = Math.floor(Math.random() * HEALTH_TIPS.length);
    this.stampCardNeed = G.stampCardNeed;
    this.running = true;
    this.paused = false;
    this._lastFrame = performance.now();
    this._showPhaseTitle('热身开始', '跟着脚印轻轻踏步，活动开身体');
    this.audio.speak('训练开始。先热身，跟着屏幕下方脚印的节奏，轻轻踏步。', true);
    this.sceneNames.push(SCENES[this.journey.sceneIndex].name);
    this.onEvent({ type: 'scene-intro', scene: SCENES[this.journey.sceneIndex] });
    this._resize();
    this._loop();
  }

  pause(reason) {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.pauseReason = reason;
    this.events.push({ t: Math.round(this.simTime), type: 'pause', reason });
  }

  resume() {
    if (!this.running || !this.paused) return;
    if (this.pauseReason === 'rpe') { /* RPE 由 answerRpe 恢复 */ }
    this.paused = false;
    this.pauseReason = null;
    this._lastFrame = performance.now();
  }

  /** 用户主动结束（保留已完成部分） */
  stop(reason = 'user') {
    this.finishSession(reason);
  }

  finishSession(endedBy) {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    const dur = {
      warmup: this._phaseElapsedTotal('warmup'),
      main: this._phaseElapsedTotal('main'),
      cooldown: this._phaseElapsedTotal('cooldown'),
    };
    dur.total = Math.round(this.simTime);
    const cadSamples = this.samples.map(s => s.cadence).filter(c => c > 0);
    const hrVals = this.hrSeries.map(s => s.v).filter(v => v > 40);
    const session = {
      date: new Date().toISOString(),
      endedBy,
      mode: this.plan.mode,
      setting: this.plan.setting || 'home',
      quick: !!this.plan.quick,
      durationSec: dur,
      steps: this.stepsThisSession,
      distanceKm: this.sessionKm,
      avgCadence: cadSamples.length ? Math.round(cadSamples.reduce((a, b) => a + b, 0) / cadSamples.length) : 0,
      maxCadence: cadSamples.length ? Math.max(...cadSamples) : 0,
      stampsEarned: this.stampsEarned,
      itemsCaught: this.itemsCaught,
      kcal: this.stepsThisSession * G.kcalPerStep,
      rpeSamples: this.rpeSamples,
      hrSeries: this.hrSeries,
      samples: this.samples,
      events: this.events,
      autoPauses: this.autoPauses,
      sceneNames: this.sceneNames,
      hrAvg: hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null,
      hrMax: hrVals.length ? Math.max(...hrVals) : null,
      snapshot: {
        age: this.profile.age,
        restingHr: this.profile.restingHr,
        betaBlocker: this.profile.betaBlocker,
        hrZone: this.hrZone,
      },
    };
    // 更新旅程
    this.journey.totalKm = +(this.journey.totalKm + this.sessionKm).toFixed(3);
    this.journey.stampsTotal += this.stampsEarned;
    this.onEvent({ type: 'end', session, journey: this.journey });
  }

  _phaseElapsedTotal(name) {
    return Math.round(this._phaseTime[name] || (this.phase === name ? this.phaseElapsed : 0));
  }

  /* ---------------- 主循环 ---------------- */

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastFrame) / 1000);
    this._lastFrame = now;

    const bodyState = this.body.update(now);
    this.bodyState = bodyState;
    // 摄像头模式：左下角预览实时绘制（drawPreview 内部自判 demo/空指针）
    this.body.drawPreview();

    if (!this.paused) this._update(dt, bodyState, now);
    this._render(now);

    // HUD 4Hz
    if (now - (this._lastHud || 0) > 250) {
      this._lastHud = now;
      this.onHud(this.hudSnapshot());
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  _update(dt, bs, now) {
    this.simTime += dt;
    this.phaseElapsed += dt;
    this._phaseTime = this._phaseTime || {};
    this._phaseTime[this.phase] = (this._phaseTime[this.phase] || 0) + dt;

    /* --- 步数与里程 --- */
    const dSteps = Math.max(0, bs.steps - this.lastSteps);
    this.lastSteps = bs.steps;
    this.stepsThisSession += dSteps;
    this.sessionKm = this.stepsThisSession / G.stepsPerKm;
    this.dispCadence += (bs.cadence - this.dispCadence) * Math.min(1, dt * 2);

    // 视觉前进速度：随实际步频，保留轻微"风"的漂移
    const speedFactor = 0.12 + 0.88 * Math.min(1.3, this.dispCadence / T.start);
    this.visDist += 0.001285 * speedFactor * dt;

    /* --- 节拍器 --- */
    const beatPeriod = 60 / this.tempo;
    this.beatAcc += dt;
    while (this.beatAcc >= beatPeriod) {
      this.beatAcc -= beatPeriod;
      this.audio.tick(this.beatStrong);
      this.beatStrong = !this.beatStrong;
    }
    this.beatPhase = this.beatAcc / beatPeriod;

    /* --- 阶段推进 --- */
    if (this.phaseElapsed >= this.phaseDur) {
      if (this.phase === 'warmup') this._enterPhase('main');
      else if (this.phase === 'main') this._enterPhase('cooldown');
      else { this.finishSession('completed'); return; }
    }

    /* --- RPE 定时 --- */
    if (this.phase === 'main' && this.simTime >= this.rpeNextAt) {
      this.rpeNextAt += this.rpeInterval;
      this.pause('rpe');
      this.audio.chime();
      this.onEvent({ type: 'rpe' });
      return;
    }

    /* --- 整理阶段：康复小知识轮播 --- */
    if (this.phase === 'cooldown') {
      if (this.tipNextAt === Infinity) this.tipNextAt = this.simTime + 15;
      if (this.simTime >= this.tipNextAt) {
        this.tipIdx = (this.tipIdx + 1) % HEALTH_TIPS.length;
        this.tipToast = { text: HEALTH_TIPS[this.tipIdx], until: this.simTime + 20 };
        this.tipNextAt = this.simTime + 20;
      }
    }

    /* --- 心率安全 --- */
    this._updateHr(dt);

    /* --- 物件生成 --- */
    const canSpawn = bs.ok && this.phase !== 'cooldown' && !this.celebrate;
    if (canSpawn) {
      const mul = this.phase === 'warmup' ? 2.2 : 1;
      this.stampTimer -= dt / mul;
      this.bonusTimer -= dt;
      if (this.stampTimer <= 0) {
        this._spawnItem('stamp');
        this.stampTimer = G.stampEverySec * (0.75 + Math.random() * 0.5);
      }
      if (this.bonusTimer <= 0) {
        const kinds = ['lantern', 'flower', 'flower', 'water', 'koi'];
        this._spawnItem(kinds[Math.floor(Math.random() * kinds.length)]);
        this.bonusTimer = G.bonusEverySec * (0.7 + Math.random() * 0.6);
      }
    }

    /* --- 物件更新与捕捉 --- */
    const W = this.canvas.width / (this._dpr || 1), H = this.canvas.height / (this._dpr || 1);
    const aspect = W / H;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age > it.life) { this.items.splice(i, 1); continue; }
      if (bs.wrists) {
        for (const w of bs.wrists) {
          if ((w.vis ?? 1) < 0.4) continue;
          const dx = (w.x - it.x) * aspect, dy = w.y - it.y;
          if (dx * dx + dy * dy < G.itemRadius * G.itemRadius) {
            this._catch(it, bs);
            this.items.splice(i, 1);
            break;
          }
        }
      }
    }

    /* --- 合拍奖励 --- */
    if (this.phase === 'main' && Math.abs(this.dispCadence - this.tempo) <= G.syncTolerance && this.dispCadence > 40) {
      this.syncTime += dt;
      if (this.syncTime >= G.syncBonusSec) {
        this.syncTime = 0;
        this._addStamp(true);
        this.syncFlashT = 2;
        this.audio.stamp();
        this.audio.speak('节拍踩得又准又稳，奖励一枚金印！');
      }
    } else {
      this.syncTime = Math.max(0, this.syncTime - dt * 1.5);
    }
    this.syncFlashT = Math.max(0, this.syncFlashT - dt);

    /* --- 庆祝与场景切换 --- */
    if (this.celebrate && this.simTime >= this.celebrate.until) this._finishCelebrate();
    if (this.transition && this.simTime >= this.transition.until) this.transition = null;
    if (this.phaseTitle && this.simTime >= this.phaseTitle.until) this.phaseTitle = null;

    /* --- 提示与鼓励 --- */
    this._updateCoaching(dt, bs);

    /* --- 采样 --- */
    this.sampleAcc += dt;
    if (this.sampleAcc >= 5) {
      this.sampleAcc = 0;
      this.samples.push({
        t: Math.round(this.simTime), phase: this.phase,
        hr: this.hr.bpm || null, cadence: Math.round(this.dispCadence), tempo: this.tempo,
      });
    }
    if (this.hr.bpm && !this.hr.manual) {
      this.hrSampleAcc += dt;
      if (this.hrSampleAcc >= 2) {
        this.hrSampleAcc = 0;
        this.hrSeries.push({ t: Math.round(this.simTime), v: this.hr.bpm });
      }
    }

    /* --- 特效 --- */
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      if (e.age > e.dur) this.effects.splice(i, 1);
    }
  }

  _updateHr(dt) {
    const bpm = this.hr.bpm;
    if (!bpm || this.hr.manual || !this.hrZone) return;
    // β受体阻滞剂/起搏器：心率法失真 → 不做自动暂停，仅记录事件（HUD 仍会变色提示）
    const beta = !!this.profile.betaBlocker;
    if (bpm > this.hrZone.high) {
      this.hrOverSec += dt;
      if (beta) {
        if (this.hrOverSec >= (this.hrOverLimitSec ?? CONFIG.medical.hrOverLimitPauseSec)) {
          this.hrOverSec = 0;
          this.events.push({ t: Math.round(this.simTime), type: 'beta-hr-high', bpm });
        }
        return;
      }
      if (this.hrOverSec >= this.hrOverLimitSec && !this.paused) {
        this.hrOverSec = 0;
        this.autoPauses++;
        this.pause('hr-high');
        this.audio.warn();
        this.audio.speak('心率偏高，我们先休息一会儿，跟着圆圈深呼吸。', true);
        this.onEvent({ type: 'hr-pause', bpm, suggestEnd: this.autoPauses >= 3 });
      }
    } else {
      this.hrOverSec = Math.max(0, this.hrOverSec - dt * 2);
    }
  }

  _updateCoaching(dt, bs) {
    // 身体丢失提示
    if (!bs.ok && bs.mode === 'camera') {
      this.noBodySince = this.noBodySince || this.simTime;
    } else this.noBodySince = null;

    // 步频太低提示（主运动阶段）
    if (this.phase === 'main' && this.dispCadence > 0 && this.dispCadence < this.tempo - 25) {
      this.lowCadenceSince = this.lowCadenceSince || this.simTime;
      if (this.simTime - this.lowCadenceSince > 12) {
        this.lowCadenceSince = this.simTime;
        this.audio.speak('跟着屏幕下方的脚印节奏，轻轻踏步就好。');
      }
    } else this.lowCadenceSince = null;

    // 定期鼓励
    if (this.simTime >= this.encourageAt) {
      this.encourageAt += 80 + Math.random() * 40;
      if (this.phase !== 'cooldown') {
        this.audio.speak(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]);
      }
    }
  }

  /* ---------------- 阶段与场景 ---------------- */

  _enterPhase(name) {
    this.phase = name;
    this.phaseElapsed = 0;
    this._phaseTime = this._phaseTime || {};
    if (name === 'main') {
      this.phaseDur = this.plan.mainSec;
      this.tempo = T.start;
      this._showPhaseTitle('主运动', '保持"有点累"的感觉，摘取印章吧');
      this.audio.chime();
      this.audio.speak('热身完成，正式启程！保持有点累、还能说话的节奏。', true);
    } else if (name === 'cooldown') {
      this.phaseDur = this.plan.cooldownSec;
      this.tempo = T.cooldown;
      this.items = [];
      this._showPhaseTitle('整理放松', '放慢脚步，跟着圆圈深呼吸');
      this.audio.chime();
      this.audio.speak('运动部分完成，很棒！慢慢放松，跟着圆圈调整呼吸。', true);
    }
    this.onEvent({ type: 'phase', phase: name });
  }

  _showPhaseTitle(text, sub) {
    this.phaseTitle = { text, sub, until: this.simTime + 3.5 };
  }

  _spawnItem(kind) {
    const bs = this.bodyState;
    const reach = bs.reach || { cx: 0.5, shoulderY: 0.38, minX: 0.12, maxX: 0.88, torso: 0.24 };
    const tiers = this.plan.mode === 'seated'
      ? ['high', 'mid', 'side']
      : ['high', 'mid', 'mid', 'low', 'side'];
    const tier = kind === 'stamp' ? tiers[Math.floor(Math.random() * tiers.length)] : 'mid';
    let x, y;
    const pad = 0.06;
    const xmin = reach.minX + pad, xmax = reach.maxX - pad;
    switch (tier) {
      case 'high': y = reach.shoulderY - reach.torso * 0.62; x = rand(xmin, xmax); break;
      case 'low': y = reach.shoulderY + reach.torso * 0.66; x = rand(xmin, xmax); break;
      case 'side': y = reach.shoulderY + reach.torso * 0.08; x = Math.random() < 0.5 ? xmin : xmax; break;
      default: y = reach.shoulderY - reach.torso * 0.02; x = rand(xmin, xmax);
    }
    y = Math.max(0.06, Math.min(0.82, y));
    this.items.push({
      kind, tier, x, y,
      age: 0, life: G.itemLifeSec,
      seed: Math.random() * 10,
    });
  }

  _catch(it, bs) {
    this.itemsCaught++;
    this.effects.push({ x: it.x, y: it.y, age: 0, dur: 0.8, kind: it.kind });
    this.audio.catchItem();
    switch (it.kind) {
      case 'stamp':
        this._addStamp(false);
        this.audio.stamp();
        break;
      case 'koi':
        this.audio.speak('锦鲤附体，好运连连！');
        break;
      case 'water':
        this.audio.speak('收到水壶，记得小口补水。');
        break;
      case 'lantern':
        break;
      case 'flower':
        break;
    }
  }

  _addStamp(golden) {
    this.stampsEarned++;
    this.journey.stampsInScene++;
    if (golden) {
      this.effects.push({ x: 0.5, y: 0.35, age: 0, dur: 1.5, kind: 'goldstamp' });
    }
    if (this.journey.stampsInScene >= this.stampCardNeed && !this.celebrate) {
      const scene = SCENES[this.journey.sceneIndex];
      this.celebrate = { scene, startedAt: this.simTime, until: this.simTime + 4.2 };
      this.audio.gong();
      this.audio.speak(`${scene.name}打卡完成！印章已收入通关文牒，即将前往下一站。`, true);
    }
    this.onEvent({ type: 'journey-update', journey: this.journey });
  }

  _finishCelebrate() {
    const c = this.celebrate;
    this.celebrate = null;
    this.journey.stampsInScene = 0;
    this.journey.sceneIndex++;
    if (this.journey.sceneIndex >= SCENES.length) {
      this.journey.sceneIndex = 0;
      this.journey.rounds++;
    }
    const next = SCENES[this.journey.sceneIndex];
    this.sceneNames.push(next.name);
    this.transition = {
      from: c.scene, to: next,
      startedAt: this.simTime, until: this.simTime + 2.5,
    };
    this.stampTimer = 4;
    this.audio.speak(`下一站，${next.name}。`);
    this.onEvent({ type: 'scene-complete', journey: this.journey, next });
    this.onEvent({ type: 'scene-intro', scene: next });
  }

  answerRpe(v) {
    this.rpeSamples.push({ t: Math.round(this.simTime), v });
    this.events.push({ t: Math.round(this.simTime), type: 'rpe', v });
    const { rpeTargetLow, rpeTargetHigh } = CONFIG.medical;
    if (v >= 6) {
      // 明显疲劳/不适：保守处置——直接进休息界面，缓过来后由患者决定继续或结束
      this.tempo = Math.max(T.min, this.tempo + T.rpeHighAdjust);
      this.pause('rpe-hard');
      this.audio.warn();
      this.audio.speak('很累时我们应当休息。跟着圆圈深呼吸，缓过来后可以继续，也可以今天到此为止。', true);
      this.onEvent({ type: 'hr-pause', bpm: null, reason: 'rpe', suggestEnd: true });
      return;
    }
    if (v >= 5) {
      this.tempo = Math.max(T.min, this.tempo + T.rpeHighAdjust);
      this.audio.speak('明白，我们把节奏放慢一些，舒服最重要。');
      this._showPhaseTitle('已放慢节奏', '目标步频 ' + this.tempo + ' 步/分');
    } else if (v <= 2 && this.phase === 'main') {
      this.tempo = Math.min(T.max, this.tempo + T.rpeLowAdjust);
      this.audio.speak('感觉很轻松，那我们稍微加快一点点。');
      this._showPhaseTitle('稍微加速', '目标步频 ' + this.tempo + ' 步/分');
    } else {
      this.audio.speak('很好，这个强度正合适，继续保持！');
    }
    this.pauseReason = null;
    this.resume();
  }

  /* ---------------- HUD 数据 ---------------- */

  hudSnapshot() {
    const totalRemain = this._totalRemainSec();
    const scene = SCENES[this.journey.sceneIndex];
    const bpm = this.hr.bpm;
    return {
      phase: this.phase,
      phaseLabel: { warmup: '热身', main: '主运动', cooldown: '整理放松' }[this.phase],
      phaseRemain: Math.max(0, Math.ceil(this.phaseDur - this.phaseElapsed)),
      totalRemain,
      progress: this._totalProgress(),
      cadence: Math.round(this.dispCadence),
      tempo: this.tempo,
      stamps: this.journey.stampsInScene,
      stampsNeed: this.stampCardNeed,
      stampsTotal: this.journey.stampsTotal,
      sceneName: scene.name,
      sceneCh: scene.ch,
      hr: bpm,
      hrZone: this.hrZone,
      hrManual: this.hr.manual,
      steps: this.stepsThisSession,
      distanceKm: this.sessionKm.toFixed(2),
      paused: this.paused,
      pauseReason: this.pauseReason,
    };
  }

  _totalRemainSec() {
    const plan = this.plan;
    const remainPhase = this.phaseDur - this.phaseElapsed;
    const order = ['warmup', 'main', 'cooldown'];
    let remain = Math.max(0, remainPhase);
    for (let i = order.indexOf(this.phase) + 1; i < order.length; i++) {
      remain += plan[order[i] + 'Sec'];
    }
    return Math.max(0, Math.ceil(remain));
  }
  _totalProgress() {
    const plan = this.plan;
    const total = plan.warmupSec + plan.mainSec + plan.cooldownSec;
    return Math.min(1, this.simTime / total);
  }

  /* ---------------- 渲染 ---------------- */

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
  }

  _render(now) {
    const ctx = this.ctx;
    const W = this.canvas.width / (this._dpr || 1);
    const H = this.canvas.height / (this._dpr || 1);
    ctx.setTransform(this._dpr || 1, 0, 0, this._dpr || 1, 0, 0);
    const t = now / 1000;

    const scene = SCENES[this.journey.sceneIndex];

    // 世界
    drawWorld(ctx, W, H, scene, t, this.visDist);
    if (this.transition) {
      const p = Math.min(1, (this.simTime - this.transition.startedAt) / (this.transition.until - this.transition.startedAt));
      drawWorld(ctx, W, H, this.transition.to, t, this.visDist + 0.5, { alpha: p });
    }

    // 头顶场景横幅
    this._drawSceneBanner(ctx, W);

    // 物件
    for (const it of this.items) this._drawItem(ctx, W, H, it, t);

    // 手部光点
    if (this.bodyState && this.bodyState.wrists) {
      for (const w of this.bodyState.wrists) {
        if ((w.vis ?? 1) < 0.4) continue;
        const x = w.x * W, y = w.y * H;
        const g = ctx.createRadialGradient(x, y, 2, x, y, 26);
        g.addColorStop(0, 'rgba(255,235,150,0.9)');
        g.addColorStop(1, 'rgba(255,235,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 旅行者（背影小人）
    this._drawAvatar(ctx, W, H);

    // 节拍脚印
    this._drawFootprints(ctx, W, H);

    // 合拍进度弧
    if (this.phase === 'main' && this.syncTime > 2) this._drawSyncRing(ctx, W, H);

    // 特效
    this._drawEffects(ctx, W, H);

    // 整理呼吸圆
    if (this.phase === 'cooldown') {
      this._drawBreath(ctx, W, H, t);
      // 健康小知识卡片
      if (this.tipToast && this.simTime < this.tipToast.until) {
        const fade = Math.min(1, (this.tipToast.until - this.simTime) / 0.8,
          (this.simTime - (this.tipToast.until - 20)) / 0.8 + 1);
        ctx.save();
        ctx.globalAlpha = Math.min(1, fade);
        const cw = Math.min(W * 0.8, 640), chh = 96;
        const cx = W / 2, cy = H * 0.78;
        roundRect(ctx, cx - cw / 2, cy - chh / 2, cw, chh, 14);
        ctx.fillStyle = 'rgba(20,30,40,0.72)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,184,58,0.6)';
        ctx.lineWidth = 1.5;
        roundRect(ctx, cx - cw / 2, cy - chh / 2, cw, chh, 14);
        ctx.stroke();
        ctx.fillStyle = '#ffe9a8';
        ctx.font = `600 15px system-ui, sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('💡 康复小知识', cx - cw / 2 + 20, cy - chh / 2 + 22);
        ctx.fillStyle = '#fff';
        ctx.font = `400 16px system-ui, sans-serif`;
        // 简单折行
        const text = this.tipToast.text;
        const maxW = cw - 44;
        let line = '', lines = [];
        for (const chr of text) {
          if (ctx.measureText(line + chr).width > maxW) { lines.push(line); line = chr; }
          else line += chr;
        }
        lines.push(line);
        lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, cx - cw / 2 + 20, cy + 4 + i * 24));
        ctx.restore();
      }
    }

    // 盖章庆祝
    if (this.celebrate) this._drawCelebration(ctx, W, H);

    // 阶段标题
    if (this.phaseTitle) this._drawPhaseTitle(ctx, W, H);

    // 找不到人提示
    if (this.noBodySince && this.simTime - this.noBodySince > 3) {
      this._centerToast(ctx, W, H, '请站到画面中央\n让肩膀和髋部都在镜头里', 'rgba(180,50,40,0.85)');
    }
  }

  _drawSceneBanner(ctx, W) {
    const scene = SCENES[this.journey.sceneIndex];
    ctx.save();
    ctx.globalAlpha = 0.88;
    const text = `${scene.name} · 第${this.journey.sceneIndex + 1}站`;
    ctx.font = `22px ${FONT_KAI}`;
    const w = ctx.measureText(text).width + 60;
    roundRect(ctx, W / 2 - w / 2, 14, w, 40, 20);
    ctx.fillStyle = 'rgba(30,42,56,0.55)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, 35);
    ctx.restore();
  }

  _drawAvatar(ctx, W, H) {
    const x = W * 0.5, groundY = H * 0.94;
    const s = Math.min(W, H) * 0.13;
    const phase = (this.beatPhase + (this.beatStrong ? 0 : 0.5)) % 1;
    const bob = Math.sin(phase * Math.PI * 2) * s * 0.04;
    const y = groundY - s * 1.1 + bob;
    ctx.save();
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(x, groundY + 4, s * 0.5, s * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    // 腿
    const swing = Math.sin(phase * Math.PI * 2) * 0.35;
    for (const dir of [-1, 1]) {
      const ang = swing * dir;
      ctx.save();
      ctx.translate(x + dir * s * 0.16, y + s * 0.55);
      ctx.rotate(ang);
      ctx.fillStyle = '#31465e';
      roundRect(ctx, -s * 0.09, 0, s * 0.18, s * 0.5, s * 0.08);
      ctx.fill();
      ctx.fillStyle = '#8a6d4a';
      roundRect(ctx, -s * 0.11, s * 0.42, s * 0.22, s * 0.1, s * 0.05);
      ctx.fill();
      ctx.restore();
    }
    // 身体（长衫）
    ctx.fillStyle = '#3a5a78';
    roundRect(ctx, x - s * 0.3, y, s * 0.6, s * 0.62, s * 0.12);
    ctx.fill();
    // 背包
    ctx.fillStyle = '#b03a2e';
    roundRect(ctx, x - s * 0.21, y + s * 0.06, s * 0.42, s * 0.4, s * 0.1);
    ctx.fill();
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(x - s * 0.06, y + s * 0.2, s * 0.12, s * 0.06);
    // 手臂
    ctx.fillStyle = '#3a5a78';
    const armSwing = Math.sin(phase * Math.PI * 2) * 0.3;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(x + dir * s * 0.32, y + s * 0.08);
      ctx.rotate(armSwing * dir);
      roundRect(ctx, -s * 0.07, 0, s * 0.14, s * 0.45, s * 0.07);
      ctx.fill();
      ctx.restore();
    }
    // 头 + 斗笠
    ctx.fillStyle = '#e8c9a0';
    ctx.beginPath(); ctx.arc(x, y - s * 0.12, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d4b96a';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y - s * 0.16);
    ctx.quadraticCurveTo(x, y - s * 0.52, x + s * 0.34, y - s * 0.16);
    ctx.quadraticCurveTo(x, y - s * 0.24, x - s * 0.34, y - s * 0.16);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawFootprints(ctx, W, H) {
    const cy = H * 0.965;
    const gap = Math.min(W * 0.09, 70);
    const pulse = 0.5 + 0.5 * Math.cos(this.beatPhase * Math.PI * 2);
    const left = !this.beatStrong;
    ctx.save();
    for (const dir of [-1, 1]) {
      const active = (dir === -1) === left;
      const sc = active ? 1 + pulse * 0.25 : 0.9;
      const alpha = active ? 0.9 - pulse * 0.35 : 0.3;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = active ? '#e8b83a' : '#5b6b7d';
      ctx.save();
      ctx.translate(W / 2 + dir * gap, cy);
      ctx.scale(sc, sc);
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 22, 9, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 目标步频
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(30,42,56,0.5)';
    ctx.lineWidth = 3;
    const label = `目标 ${this.tempo} 步/分`;
    ctx.font = `600 16px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 20;
    roundRect(ctx, W / 2 - tw / 2, cy - 58, tw, 26, 13);
    ctx.fillStyle = 'rgba(30,42,56,0.45)';
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(label, W / 2, cy - 44);
    ctx.restore();
  }

  _drawSyncRing(ctx, W, H) {
    const p = this.syncTime / G.syncBonusSec;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,184,58,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.965, 46, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    if (this.syncFlashT > 0) {
      ctx.globalAlpha = this.syncFlashT / 2;
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.965, 46 + (2 - this.syncFlashT) * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawItem(ctx, W, H, it, t) {
    const bobY = Math.sin(t * 2 + it.seed) * 0.012;
    const x = it.x * W, y = (it.y + bobY) * H;
    const appear = Math.min(1, it.age / 0.4);
    const expire = Math.min(1, (it.life - it.age) / 1.2);
    const alpha = appear * Math.max(0, expire);
    const s = Math.min(W, H) * (it.kind === 'stamp' ? 0.075 : 0.05);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    const pulse = 1 + Math.sin(t * 3 + it.seed) * 0.04;
    ctx.scale(pulse * appear, pulse * appear);
    // 光晕
    const g = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 1.8);
    g.addColorStop(0, 'rgba(255,230,140,0.5)');
    g.addColorStop(1, 'rgba(255,230,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 1.8, 0, Math.PI * 2); ctx.fill();

    switch (it.kind) {
      case 'stamp': {
        ctx.rotate(Math.sin(t + it.seed) * 0.08);
        ctx.fillStyle = '#c0392b';
        roundRect(ctx, -s * 0.7, -s * 0.7, s * 1.4, s * 1.4, s * 0.18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = s * 0.07;
        roundRect(ctx, -s * 0.56, -s * 0.56, s * 1.12, s * 1.12, s * 0.12);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(s * 1.05)}px ${FONT_KAI}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(SCENES[this.journey.sceneIndex].ch, 0, s * 0.06);
        break;
      }
      case 'lantern': {
        ctx.fillStyle = '#d64541';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.6, s * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f5d76e';
        ctx.fillRect(-s * 0.18, -s * 0.9, s * 0.36, s * 0.18);
        ctx.fillRect(-s * 0.18, s * 0.72, s * 0.36, s * 0.16);
        ctx.beginPath(); ctx.moveTo(0, s * 0.85); ctx.lineTo(-s * 0.14, s * 1.2); ctx.lineTo(s * 0.14, s * 1.2);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'flower': {
        ctx.fillStyle = '#e88ab0';
        for (let i = 0; i < 6; i++) {
          ctx.save(); ctx.rotate(i * Math.PI / 3);
          ctx.beginPath(); ctx.ellipse(0, -s * 0.45, s * 0.26, s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#f7d774';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'koi': {
        ctx.rotate(Math.sin(t * 2 + it.seed) * 0.3);
        ctx.fillStyle = '#e8792b';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.62, 0); ctx.lineTo(-s * 1.05, -s * 0.3); ctx.lineTo(-s * 1.05, s * 0.3);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s * 0.32, -s * 0.08, s * 0.06, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'water': {
        ctx.fillStyle = '#5dade2';
        roundRect(ctx, -s * 0.32, -s * 0.62, s * 0.64, s * 1.2, s * 0.2); ctx.fill();
        ctx.fillStyle = '#3a7ab5';
        ctx.fillRect(-s * 0.18, -s * 0.82, s * 0.36, s * 0.2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(-s * 0.18, -s * 0.4, s * 0.1, s * 0.6);
        break;
      }
    }
    ctx.restore();
  }

  _drawEffects(ctx, W, H) {
    for (const e of this.effects) {
      const p = e.age / e.dur;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      const x = e.x * W, y = (e.y - p * 0.08) * H;
      if (e.kind === 'goldstamp') {
        ctx.translate(x, y);
        const s = Math.min(W, H) * 0.12 * (1 + p * 0.6);
        ctx.fillStyle = '#ffd700';
        ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a04000';
        ctx.font = `700 ${Math.round(s)}px ${FONT_KAI}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('金', 0, 0);
      } else {
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3 + p * 2;
          const d = 20 + p * 40;
          ctx.fillStyle = '#ffe9a8';
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 5 * (1 - p) + 1, 0, Math.PI * 2);
          ctx.fill();
        }
        if (e.kind === 'stamp') {
          ctx.fillStyle = '#c0392b';
          ctx.font = `700 ${Math.round(18 + p * 8)}px ${FONT_KAI}`;
          ctx.textAlign = 'center';
          ctx.fillText('印章 +1', x, y - 34);
        }
      }
      ctx.restore();
    }
  }

  _drawBreath(ctx, W, H, t) {
    const cx = W / 2, cy = H * 0.42;
    const period = 8; // 4秒吸气 + 4秒呼气
    const ph = (t % period) / period;
    const scale = ph < 0.5 ? 0.6 + (ph / 0.5) * 0.4 : 1.0 - ((ph - 0.5) / 0.5) * 0.4;
    const r = Math.min(W, H) * 0.16 * scale;
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.15);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.7, 'rgba(160,216,230,0.55)');
    g.addColorStop(1, 'rgba(160,216,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(90,150,180,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#2b3a4a';
    ctx.font = `600 ${Math.round(Math.min(W, H) * 0.045)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ph < 0.5 ? '吸 气…' : '呼 气…', cx, cy);
    ctx.restore();
  }

  _drawCelebration(ctx, W, H) {
    const c = this.celebrate;
    const el = this.simTime - c.startedAt;
    ctx.save();
    // 遮罩
    ctx.fillStyle = 'rgba(24,32,44,0.55)';
    ctx.fillRect(0, 0, W, H);
    // 盖章动画：从大到小砸下
    const slam = Math.min(1, el / 0.55);
    const ease = 1 - Math.pow(1 - slam, 3);
    const s = Math.min(W, H) * (0.32 + (1 - ease) * 0.9);
    const cx = W / 2, cy = H * 0.44;
    ctx.translate(cx, cy);
    ctx.rotate((1 - ease) * 0.4 - 0.08);
    ctx.scale(s / 100, s / 100);
    // 印章
    ctx.fillStyle = '#c0392b';
    roundRect(ctx, -52, -52, 104, 104, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    roundRect(ctx, -42, -42, 84, 84, 10); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 64px ${FONT_KAI}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.scene.ch, 0, 4);
    ctx.restore();
    // 文案
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (el - 0.4) / 0.4));
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `700 ${Math.round(Math.min(W, H) * 0.05)}px ${FONT_KAI}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${c.scene.name} · 打卡完成！`, W / 2, H * 0.68);
    ctx.font = `400 ${Math.round(Math.min(W, H) * 0.032)}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`印章已收入通关文牒（${this.stampCardNeed} 枚集齐）`, W / 2, H * 0.68 + Math.min(W, H) * 0.05);
    // 撒花
    for (let i = 0; i < 14; i++) {
      const ang = i / 14 * Math.PI * 2 + el * 0.5;
      const d = 60 + (el % 1.2) * 120;
      ctx.fillStyle = i % 2 ? '#ffd700' : '#e88ab0';
      ctx.globalAlpha = Math.max(0, 1 - (el % 1.2) / 1.2);
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(ang) * d * 1.4, H * 0.44 + Math.sin(ang) * d, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPhaseTitle(ctx, W, H) {
    const p = this.phaseTitle;
    const remain = p.until - this.simTime;
    const alpha = Math.min(1, remain / 0.6) * Math.min(1, (this.simTime - (p.until - 3.5)) / 0.4 + 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = 'rgba(24,32,44,0.5)';
    ctx.fillRect(0, H * 0.3, W, H * 0.24);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `700 ${Math.round(Math.min(W, H) * 0.075)}px ${FONT_KAI}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.text, W / 2, H * 0.38);
    ctx.fillStyle = '#fff';
    ctx.font = `400 ${Math.round(Math.min(W, H) * 0.035)}px system-ui, sans-serif`;
    ctx.fillText(p.sub, W / 2, H * 0.47);
    ctx.restore();
  }

  _centerToast(ctx, W, H, text, color) {
    ctx.save();
    ctx.fillStyle = 'rgba(24,32,44,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color || '#fff';
    ctx.font = `600 ${Math.round(Math.min(W, H) * 0.045)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.45 + i * Math.min(W, H) * 0.06));
    ctx.restore();
  }
}

/* ---------------- 绘图工具 ---------------- */

function rand(a, b) { return a + Math.random() * (b - a); }

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
