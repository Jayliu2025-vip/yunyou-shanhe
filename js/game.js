/**
 * 游戏引擎：云游山河
 * - 三段式课程：热身 → 主运动 → 整理放松（时长见 config.session）
 * - 原地踏步推进风景（节拍器 + 脚印引导），抬手摘取印章与吉物
 * - 自适应强度：RPE 反馈调节目标步频；心率超限自动暂停
 * - 集章系统：每景点集齐 12 枚印章 → 盖章仪式 → 解锁下一景点
 */
import { CONFIG, targetHrZone } from './config.js';
import { SCENES, drawWorld, HEALTH_TIPS, preloadScenePhotosAround, ensureScenePhoto, cachedGrad } from './scenes.js';

const G = CONFIG.game;
const T = CONFIG.tempo;
const EX = CONFIG.exercise;
const FONT_KAI = '"STKaiti","KaiTi","SimSun",serif';

const ENCOURAGEMENTS = [
  '走得很好，继续保持！', '山河正美，脚步正稳！', '很棒，就这样不紧不慢地走。',
  '呼吸顺畅，步履从容，真好！', '今日份的健康，正在稳稳积累！',
];

// 里程碑语音（步数每 500 步 / 里程每 0.5km 随机一条；只夸出勤与坚持，不催强度）
const STEP_MILESTONE_LINES = [
  '已经 {n} 步啦，每一步都算数！', '{n} 步达成，稳稳的，真好！',
  '走到 {n} 步了，山河都记着呢！',
];
const KM_MILESTONE_LINES = [
  '又走了半公里，真不错！', '里程悄悄涨了半公里，继续保持！', '半公里的风景又被你收进文牒啦！',
];
const COMBO_LINES = ['手眼协调真棒！', '连着摘到好几个，眼明手快！', '这波配合真流畅！'];

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
    // 力量小站（v1.3：主运动间歇坐站，plan.strengthBlocks 开启）
    this.block = null;         // {state:'announce'|'active', title, startedAt, until, repsAtStart, nextStampReps, lastReps, lastHintAt}
    this.blockNextAt = Infinity;
    this.blockSkip = false;    // RPE≥5 → 跳过下一个小站
    this.sitStandReps = 0;     // 本次训练起坐总数
    this.sitStandBase = null;  // BodyInput 累计计数基线（BodyInput 跨局复用，需取差值）
    this.blocksRun = 0;
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
    this.scenesCompleted = 0;   // 本次完成盖章仪式（集齐一站）的次数
    // 背景远眺巡游（只换背景照片层，当前景点/印章语义不变）
    this.displayScene = null;   // 当前显示的背景场景
    this.tourFade = null;       // {from, to, startedAt} 淡切过渡
    this.tourNextAt = Infinity;
    // 趣味反馈状态（v1.2：连击/里程碑/末印预告）
    this.combo = 0;
    this.lastCatchAt = -99;
    this.comboPraiseAt = -99;
    this.nextStepMilestone = 500;
    this.nextKmMilestone = 0.5;
    this.lastMinuteAnnounced = false;
  }

  /* ---------------- 生命周期 ---------------- */

  start(plan) {
    this.reset();
    this.plan = plan;
    this.hrZone = plan.hrZone;
    // 监护方式：'hr'=实时心率（蓝牙/研究设备）；'manual'=手动脉搏；'rpe'=无设备（RPE+症状+说话测试）
    this.monitor = plan.monitor || 'rpe';
    this.rpePrimary = this.monitor !== 'hr' || !!this.profile.betaBlocker;
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
    preloadScenePhotosAround(this.journey.sceneIndex); // 当前站+下一站照片按需预取
    // BodyInput 对象跨局复用（同模式不重建），步数与起坐计数是页面累计值 → 取当前值为基线，防跨局重复累计
    this.lastSteps = this.body ? this.body.steps : 0;
    this.sitStandBase = this.body ? this.body.sitStandReps : null;
    // 力量小站排期：主运动开始 90 秒后第一个（有氧先进入稳态），默认关闭；
    // 快速体验模式压缩为热身结束即小站，便于演示/调试完整流程
    this.blockNextAt = this.plan.strengthBlocks
      ? this.plan.warmupSec + (this.plan.quick ? 5 : EX.firstBlockAfterSec)
      : Infinity;
    // 背景巡游：15 秒后开始"远眺"其他风景（暂停时 simTime 停走，巡游同步暂停）
    this.displayScene = SCENES[this.journey.sceneIndex];
    this.tourNextAt = CONFIG.scene.tourSec > 0 ? CONFIG.scene.tourSec : Infinity;
    this._showPhaseTitle('热身开始', '跟着脚印轻轻踏步，活动开身体');
    // 无设备模式开场告知安全主控方式（说话测试口诀，CSANZ 2023 / 中国居家康复共识口径）
    const intro = this.monitor === 'rpe'
      ? '训练开始。本次以疲劳感觉和症状为主：保持能说话、但唱不了歌的强度；如有胸闷气短头晕，请立即停止。先热身，跟着脚印的节奏轻轻踏步。'
      : '训练开始。先热身，跟着屏幕下方脚印的节奏，轻轻踏步。';
    this.audio.speak(intro, true);
    // 力量小站：开场告知椅子前置要求（安全底线：稳固、靠墙、无轮）
    if (this.plan.strengthBlocks) {
      this.audio.speak('本次已开启力量小站。请准备一把稳固、靠墙、无轮子的椅子，放在镜头前，稍后会提示您做坐站练习。', true);
    }
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
      monitor: this.monitor,          // 'hr' | 'manual' | 'rpe'（无设备模式）
      quick: !!this.plan.quick,
      scenesCompleted: this.scenesCompleted,  // 本次集齐整站（盖章仪式）次数
      durationSec: dur,
      steps: this.stepsThisSession,
      distanceKm: this.sessionKm,
      avgCadence: cadSamples.length ? Math.round(cadSamples.reduce((a, b) => a + b, 0) / cadSamples.length) : 0,
      maxCadence: cadSamples.length ? Math.max(...cadSamples) : 0,
      stampsEarned: this.stampsEarned,
      itemsCaught: this.itemsCaught,
      sitStandReps: this.sitStandReps || 0,   // 力量小站：本次起坐总数
      blocksRun: this.blocksRun || 0,         // 力量小站：完成组数
      strengthBlocks: !!this.plan.strengthBlocks,
      kcal: this.stepsThisSession * (this.profile.weightKg || 70) * G.kcalPerStepPerKg, // 按档案体重折算
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
    // 力量小站进行中：起坐动作可能被摆臂后备误计为"步" → 暂停里程累计（安全语义：小站不产生有氧里程）
    if (this.block && this.block.state === 'active') {
      this.lastSteps = bs.steps;
    } else {
      const dSteps = Math.max(0, bs.steps - this.lastSteps);
      this.lastSteps = bs.steps;
      this.stepsThisSession += dSteps;
    }
    this.sessionKm = this.stepsThisSession / G.stepsPerKm;
    this.dispCadence += (bs.cadence - this.dispCadence) * Math.min(1, dt * 2);

    /* --- 力量小站：累计本次训练起坐总数（取差值，兼容 BodyInput 跨局复用） --- */
    if (bs.sitStand) {
      if (this.sitStandBase == null || bs.sitStand.reps < this.sitStandBase) {
        this.sitStandBase = bs.sitStand.reps;
      }
      this.sitStandReps = bs.sitStand.reps - this.sitStandBase;
    }

    /* --- 里程碑（趣味反馈：只夸出勤与坚持，不催强度） --- */
    if (this.stepsThisSession >= this.nextStepMilestone) {
      const n = this.nextStepMilestone;
      this.nextStepMilestone += 500;
      this.audio.milestone();
      this.audio.speak(pickLine(STEP_MILESTONE_LINES).replace('{n}', n));
    }
    if (this.sessionKm >= this.nextKmMilestone) {
      this.nextKmMilestone += 0.5;
      this.audio.milestone();
      this.audio.speak(pickLine(KM_MILESTONE_LINES));
    }

    // 视觉前进速度：随实际步频，保留轻微"风"的漂移；小站坐站期间画面近乎静止
    const blockActive = !!(this.block && this.block.state === 'active');
    const speedFactor = blockActive ? 0.15 : 0.12 + 0.88 * Math.min(1.3, this.dispCadence / T.start);
    this.visDist += 0.001285 * speedFactor * dt;

    /* --- 节拍器（连续合拍时叠加亮色泛音，正反馈"踩在点上"；小站期间节拍即起坐节拍） --- */
    const beatTempo = blockActive ? EX.blockTempo : this.tempo;
    const beatPeriod = 60 / beatTempo;
    const inSyncBeat = this.phase === 'main' && this.syncTime > 2;
    this.beatAcc += dt;
    while (this.beatAcc >= beatPeriod) {
      this.beatAcc -= beatPeriod;
      this.audio.tick(this.beatStrong, inSyncBeat);
      this.beatStrong = !this.beatStrong;
    }
    this.beatPhase = this.beatAcc / beatPeriod;

    /* --- 阶段推进 --- */
    if (this.phaseElapsed >= this.phaseDur) {
      if (this.phase === 'warmup') this._enterPhase('main');
      else if (this.phase === 'main') this._enterPhase('cooldown');
      else { this.finishSession('completed'); return; }
    }

    /* --- 主运动最后一分钟播报（告知进度，不催促） --- */
    if (this.phase === 'main' && !this.lastMinuteAnnounced && this.phaseDur - this.phaseElapsed <= 60) {
      this.lastMinuteAnnounced = true;
      this.audio.speak('主运动还剩最后一分钟，稳住这个节奏就好，很棒！');
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

    /* --- 背景远眺巡游：每 tourSec 缓变切一张其他风景（只换照片层，安全缓变不闪） --- */
    if (this.simTime >= this.tourNextAt) {
      this.tourNextAt = this.simTime + CONFIG.scene.tourSec;
      const cur = SCENES[this.journey.sceneIndex];
      const pool = SCENES.filter(s => s !== cur && s !== this.tourFade?.to && s._photoImg);
      if (pool.length && !this.celebrate && !this.transition) {
        this.tourFade = { from: this.displayScene, to: pool[Math.floor(Math.random() * pool.length)], startedAt: this.simTime };
      }
      ensureScenePhoto(SCENES[Math.floor(Math.random() * SCENES.length)]); // 慢慢扩大已加载池
    }
    if (this.tourFade && this.simTime - this.tourFade.startedAt >= CONFIG.scene.tourFadeSec) {
      this.displayScene = this.tourFade.to;
      this.tourFade = null;
    }

    /* --- 心率安全 --- */
    this._updateHr(dt);

    /* --- 力量小站状态机（预告 → 坐站 → 收尾；RPE 弹窗暂停时 simTime 冻结自然顺延） --- */
    this._updateBlock(dt, bs);

    /* --- 物件生成（小站期间印章改由起坐数发放，见 _updateBlock） --- */
    const canSpawn = bs.ok && this.phase !== 'cooldown' && !this.celebrate && !this.block;
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

    /* --- 合拍奖励（小站期间不累计：坐站节奏与步频处方是两回事，不混淆强度语义） --- */
    if (this.phase === 'main' && !blockActive
      && Math.abs(this.dispCadence - this.tempo) <= G.syncTolerance && this.dispCadence > 40) {
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

  /* ---------------- 力量小站（间歇坐站，plan.strengthBlocks 开启） ---------------- */

  /** 当前起坐节拍（HUD/脚印显示用）：小站期间为慢速坐站节拍，其余为步频处方 */
  _effTempo() {
    return this.block && this.block.state === 'active' ? EX.blockTempo : this.tempo;
  }

  _updateBlock(dt, bs) {
    const b = this.block;
    if (b) {
      // 阶段推进（simTime 在暂停时冻结，RPE/休息弹窗天然顺延小站）
      if (this.simTime >= b.until) {
        if (b.state === 'announce') {
          b.state = 'active';
          b.startedAt = this.simTime;
          b.until = this.simTime + EX.blockDurSec;
        } else {
          this._endBlock(false);
          return;
        }
      }
      if (b.state === 'active') {
        b.lastReps = Math.max(0, this.sitStandReps - b.repsAtStart);
        // 起坐驱动发章：每 repsPerStamp 次起坐一枚（数量被 75s×15次/分 封顶，不奖励快和猛）
        if (b.lastReps >= b.nextStampReps) {
          b.nextStampReps += EX.repsPerStamp;
          this._spawnItem('stamp');
          this.audio.stamp();
        }
        // 膝部不可见（镜头太近/坐姿出画）：温和提醒，不惩罚
        if (bs.mode === 'camera' && bs.sitStand && !bs.sitStand.ok
          && this.simTime - (b.lastHintAt || 0) > 15) {
          b.lastHintAt = this.simTime;
          this.audio.speak('请让全身入镜，看到膝盖才能计数起坐。也可以点"跳过小站"继续踏步。');
        }
      }
      return;
    }
    // 到点开小站：跳过本站（RPE≥5）则顺延
    if (this.phase !== 'main') return;
    if (this.simTime < this.blockNextAt) return;
    if (this.celebrate || this.transition) return;
    if (this.blockSkip) {
      this.blockSkip = false;
      this.blockNextAt = this.simTime + EX.blockEverySec;
      this.audio.speak('您刚才反馈比较累，这个小站先跳过，继续轻松踏步。');
      return;
    }
    this._beginBlock(bs);
  }

  _beginBlock(bs) {
    // 武当山站的小站做主题包装（"不只是风景"：太极文化与坐站桩功呼应）
    const theme = SCENES[this.journey.sceneIndex].id === 'wudang' ? '太极桩功' : '力量小站';
    this.block = {
      state: 'announce',
      title: `${theme} · 坐站`,
      startedAt: this.simTime,
      until: this.simTime + EX.announceSec,
      repsAtStart: this.sitStandReps,
      nextStampReps: EX.repsPerStamp,
      lastReps: 0,
      lastHintAt: 0,
    };
    this.audio.chime();
    this.audio.speak(`${theme}时间到。请面向椅子，扶稳、慢慢坐下，跟着节拍起坐；慢起慢坐不憋气，不舒服就跳过。`, true);
    this._showPhaseTitle(this.block.title, '慢起慢坐 · 不憋气 · 可随时跳过');
    this.events.push({ t: Math.round(this.simTime), type: 'block-start', title: this.block.title });
  }

  _endBlock(skipped) {
    const b = this.block;
    this.block = null;
    this.blockNextAt = this.simTime + EX.blockEverySec;
    this.events.push({ t: Math.round(this.simTime), type: skipped ? 'block-skip' : 'block-end', reps: b.lastReps || 0 });
    if (skipped) {
      this.audio.speak('好的，跳过小站，继续踏步，舒服最重要。');
      this._showPhaseTitle('已跳过小站', '继续踏步，保持节奏');
      return;
    }
    this.blocksRun++;
    this.audio.milestone();
    this.audio.speak(`小站完成！刚才完成了 ${b.lastReps || 0} 次起坐。腿上有力量，走得才稳当。休息一下，继续踏步。`);
    this._showPhaseTitle('小站完成', '继续踏步，保持节奏');
  }

  /** 玩家主动跳过当前小站（HUD"跳过小站"按钮） */
  skipBlock() {
    if (!this.block) return;
    this._endBlock(true);
  }

  _updateCoaching(dt, bs) {
    // 身体丢失提示
    if (!bs.ok && bs.mode === 'camera') {
      this.noBodySince = this.noBodySince || this.simTime;
    } else this.noBodySince = null;

    // 步频太低提示（主运动阶段；力量小站期间坐站节拍本来就低，不提醒）
    if (this.phase === 'main' && !this.block && this.dispCadence > 0 && this.dispCadence < this.tempo - 25) {
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
      this.block = null;   // 主运动结束时小站未完成则直接作废（整理阶段只做放松）
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
    // 本站最后一枚印章：金框脉冲标记 + 专属预告音（集齐即触发盖章仪式）
    const isFinal = kind === 'stamp'
      && this.journey.stampsInScene === this.stampCardNeed - 1
      && !this.celebrate
      && !this.items.some(i => i.final);
    if (isFinal) {
      this.audio.finalStamp();
      this.audio.speak(`这是${SCENES[this.journey.sceneIndex].name}的最后一枚印章，抬手摘下它！`);
    }
    this.items.push({
      kind, tier, x, y,
      age: 0, life: G.itemLifeSec,
      seed: Math.random() * 10,
      final: isFinal,
    });
  }

  _catch(it, bs) {
    this.itemsCaught++;
    // 连击：8 秒内连续摘到 → 五声音阶逐级上行（只奖励手眼协调，与运动强度无关）
    this.combo = (this.simTime - this.lastCatchAt <= 8) ? this.combo + 1 : 1;
    this.lastCatchAt = this.simTime;
    if (this.combo >= 2) {
      this.audio.combo(this.combo);
      this.effects.push({ x: it.x, y: Math.max(0.08, it.y - 0.07), age: 0, dur: 0.9, kind: 'combo', n: this.combo });
      if (this.combo >= 4 && this.simTime - this.comboPraiseAt > 30) {
        this.comboPraiseAt = this.simTime;
        this.audio.speak(pickLine(COMBO_LINES));
      }
    } else {
      this.audio.catchItem();
    }
    this.effects.push({ x: it.x, y: it.y, age: 0, dur: 0.8, kind: it.kind });
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
    this.scenesCompleted++;
    this.journey.stampsInScene = 0;
    this.journey.sceneIndex++;
    if (this.journey.sceneIndex >= SCENES.length) {
      this.journey.sceneIndex = 0;
      this.journey.rounds++;
    }
    preloadScenePhotosAround(this.journey.sceneIndex); // 新一站+下一站照片预取
    const next = SCENES[this.journey.sceneIndex];
    this.sceneNames.push(next.name);
    // 换站：背景巡游回到新站，重新计时
    this.displayScene = next;
    this.tourFade = null;
    this.tourNextAt = this.simTime + CONFIG.scene.tourSec;
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
      // 力量小站：RPE≥5 跳过下一个小站（安全优先，见 config.exercise.rpeSkipAt）
      if (this.plan.strengthBlocks) this.blockSkip = true;
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
      tempo: this._effTempo(),   // 小站期间显示坐站节拍
      stamps: this.journey.stampsInScene,
      stampsNeed: this.stampCardNeed,
      stampsTotal: this.journey.stampsTotal,
      sceneName: scene.name,
      sceneCh: scene.ch,
      hr: bpm,
      hrZone: this.hrZone,
      hrManual: this.hr.manual,
      rpePrimary: this.rpePrimary,   // 无设备/β阻滞剂 → RPE 主控（HUD 显示用）
      monitor: this.monitor,
      steps: this.stepsThisSession,
      distanceKm: this.sessionKm.toFixed(2),
      paused: this.paused,
      pauseReason: this.pauseReason,
      // 力量小站实时状态（HUD 显示起坐数/倒计时 + 跳过按钮显隐）
      block: this.block ? {
        state: this.block.state,
        title: this.block.title,
        remain: Math.max(0, Math.ceil(this.block.until - this.simTime)),
        reps: this.block.state === 'active' ? Math.max(0, this.sitStandReps - this.block.repsAtStart) : 0,
      } : null,
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

    // 世界（背景 = displayScene：当前站或"远眺"的其他风景；物件/印章字仍是当前站）
    const bg = this.displayScene || scene;
    drawWorld(ctx, W, H, bg, t, this.visDist);
    if (this.tourFade) {
      const p = Math.min(1, (this.simTime - this.tourFade.startedAt) / CONFIG.scene.tourFadeSec);
      drawWorld(ctx, W, H, this.tourFade.to, t, this.visDist + 0.5, { alpha: p });
    }
    if (this.transition) {
      const p = Math.min(1, (this.simTime - this.transition.startedAt) / (this.transition.until - this.transition.startedAt));
      drawWorld(ctx, W, H, this.transition.to, t, this.visDist + 0.5, { alpha: p });
    }

    // 头顶场景横幅
    this._drawSceneBanner(ctx, W);

    // 物件
    for (const it of this.items) this._drawItem(ctx, W, H, it, t);

    // 手部光点（渐变按固定半径缓存，平移到原点绘制）
    if (this.bodyState && this.bodyState.wrists) {
      for (const w of this.bodyState.wrists) {
        if ((w.vis ?? 1) < 0.4) continue;
        const x = w.x * W, y = w.y * H;
        const g = cachedGrad('wrist', () => {
          const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
          gr.addColorStop(0, 'rgba(255,235,150,0.9)');
          gr.addColorStop(1, 'rgba(255,235,150,0)');
          return gr;
        });
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
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
    // 背景若正"远眺"其他风景，横幅小字标注，避免患者混淆当前站点
    const touring = this.tourFade ? this.tourFade.to
      : (this.displayScene && this.displayScene !== scene ? this.displayScene : null);
    ctx.save();
    ctx.globalAlpha = 0.88;
    const text = touring
      ? `${scene.name} · 第${this.journey.sceneIndex + 1}站 · 远眺${touring.name}`
      : `${scene.name} · 第${this.journey.sceneIndex + 1}站`;
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
    // 目标步频（小站期间改为起坐节拍提示）
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(30,42,56,0.5)';
    ctx.lineWidth = 3;
    const blockActive = this.block && this.block.state === 'active';
    const label = blockActive ? `起坐节拍 ${EX.blockTempo} 次/分` : `目标 ${this.tempo} 步/分`;
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
    // 光晕（按尺寸缓存渐变，避免每帧新建）
    const g = cachedGrad(`item:${Math.round(s)}`, () => {
      const gr = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 1.8);
      gr.addColorStop(0, 'rgba(255,230,140,0.5)');
      gr.addColorStop(1, 'rgba(255,230,140,0)');
      return gr;
    });
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
        // 末印：金色脉冲虚线框 + "末印"角标
        if (it.final) {
          const pul = 1 + Math.sin(t * 4) * 0.05;
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = s * 0.08;
          ctx.setLineDash([s * 0.18, s * 0.11]);
          ctx.strokeRect(-s * 0.88 * pul, -s * 0.88 * pul, s * 1.76 * pul, s * 1.76 * pul);
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffd700';
          ctx.font = `700 ${Math.round(s * 0.34)}px ${FONT_KAI}`;
          ctx.fillText('末印', 0, -s * 1.08 * pul);
        }
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
      if (e.kind === 'combo') {
        // 连击浮字：字号随连击数微增，金色渐隐
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = 'rgba(40,30,10,0.6)';
        ctx.lineWidth = 3;
        ctx.font = `700 ${16 + Math.min(10, e.n * 1.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.strokeText(`连击 ×${e.n}`, x, y);
        ctx.fillText(`连击 ×${e.n}`, x, y);
      } else if (e.kind === 'goldstamp') {
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
function pickLine(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
