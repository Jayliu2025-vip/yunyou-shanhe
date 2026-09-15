/**
 * 人体姿态输入模块
 * 两种模式：
 *  1. 摄像头模式：MediaPipe PoseLandmarker（本地 vendor/ 模型，离线可用）
 *  2. 演示模式：键盘←→踏步、↑起坐 + 鼠标当手（无摄像头也能跑通全流程，便于演示与调试）
 *
 * 对游戏引擎统一输出 BodyState：
 *  { ok, wrists[], reach{cx,shoulderY,minX,maxX,torso}, steps, cadence,
 *    sitStand{reps,ok}, mode }
 *
 * 踏步检测原理：踝相对髋的垂直距离（用躯干长度归一化，抗远近变化），
 * 带"站立基线自适应 + 滞回"的抗抖动判定；腿部不可见（如坐姿镜头偏近）时
 * 自动切换为摆臂检测。
 * 坐站检测原理（力量小站）：髋-膝-踝膝角滞回判定（站≥160°/坐≤110°，阈值见
 * config.exercise.sitStand），起身沿计 1 次；踝不可见时退化为髋-膝垂直高度比。
 */

import { CONFIG } from './config.js';

const L = {
  nose: 0, lSh: 11, rSh: 12, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAn: 27, rAn: 28,
};
const CONNECTIONS = [
  [L.lSh, L.rSh], [L.lSh, 13], [13, L.lWr], [L.rSh, 14], [14, L.rWr],
  [L.lSh, L.lHip], [L.rSh, L.rHip], [L.lHip, L.rHip],
  [L.lHip, 25], [25, L.lAn], [L.rHip, 26], [26, L.rAn],
];

export class BodyInput {
  constructor(video, previewCanvas) {
    this.video = video;
    this.preview = previewCanvas;
    this.demo = false;
    this.landmarker = null;
    this.stream = null;
    this.lm = null;            // 最新一帧 landmark 数组
    this.lastVideoTime = -1;
    this.stepTimes = [];       // 步事件时间戳（performance.now）
    this.steps = 0;
    // 踏步检测状态
    this.baseRel = { l: 1.8, r: 1.8 };   // 站立基线（踝-髋/躯干）
    this.footState = { l: 'down', r: 'down' };
    this.armState = { l: 'down', r: 'down' };
    this.lastStepAt = 0;
    // 坐站检测状态（力量小站）
    this.sitStandState = null;           // 'seated' | 'standing' | null（初始未知）
    this.sitStandReps = 0;               // 本次页面会话累计起坐次数
    this.sitStandAvailable = false;      // 膝部是否可见（决定小站能否计数）
    this.lastSitStandAt = 0;
    // 平滑后的关键点（已镜像，归一化坐标）
    this.sm = null;
    // 演示模式输入
    this.pointer = { x: 0.5, y: 0.45 };
    this.autoWalk = false;
    this._autoStepAcc = 0;
    this._lastNow = 0;
    this._keyHandler = null;
    this._pointerHandler = null;
    this._touchHandler = null;
    this.onError = null;
  }

  /* ---------------- 初始化 ---------------- */

  async init({ demo = false, autoWalk = false } = {}) {
    this.demo = demo;
    this.autoWalk = autoWalk;
    if (demo) {
      this._bindDemoInput();
      return;
    }
    // 摄像头（移动端降低采集分辨率，换取推理帧率）
    const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: isMobile ? 480 : 640 },
        height: { ideal: isMobile ? 360 : 480 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    // MediaPipe（本地文件）
    const vision = await import('../vendor/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks('./vendor/wasm');
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './vendor/pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await make('GPU');
    } catch (e) {
      console.warn('GPU 加速不可用，改用 CPU：', e);
      this.landmarker = await make('CPU');
    }
  }

  stop() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.landmarker) { try { this.landmarker.close(); } catch (e) {} this.landmarker = null; }
    this._unbindDemoInput();
  }

  /* ---------------- 演示模式输入 ---------------- */

  _bindDemoInput() {
    this._keyHandler = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'a' || e.key === 'd'
        || e.key === 'A' || e.key === 'D') {
        e.preventDefault();
        this._registerStep(performance.now(), 'demo');
      }
      // 演示模式：↑/W 键模拟一次起坐（力量小站计数用）
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        this._registerSitStand(performance.now());
      }
    };
    window.addEventListener('keydown', this._keyHandler);
    this._pointerHandler = (e) => {
      const c = this._targetCanvas;
      if (!c) { this.pointer.x = e.clientX / window.innerWidth; this.pointer.y = e.clientY / window.innerHeight; return; }
      const r = c.getBoundingClientRect();
      this.pointer.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.pointer.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    };
    this._touchHandler = (e) => {
      if (e.touches[0] && this._pointerHandler) this._pointerHandler(e.touches[0]);
    };
    window.addEventListener('mousemove', this._pointerHandler);
    window.addEventListener('touchmove', this._touchHandler, { passive: true });
  }
  _unbindDemoInput() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._pointerHandler) window.removeEventListener('mousemove', this._pointerHandler);
    if (this._touchHandler) window.removeEventListener('touchmove', this._touchHandler);
  }
  /** 演示模式下让鼠标事件换算到游戏画布 */
  setPointerTarget(canvas) { this._targetCanvas = canvas; }

  _registerStep(now, side) {
    if (now - this.lastStepAt < 200) return; // 最快 300 步/分
    this.lastStepAt = now;
    this.steps++;
    this.stepTimes.push(now);
  }

  /** 演示模式触屏踏步按钮（手机演示用） */
  tapStep() {
    this._registerStep(performance.now(), 'tap');
  }

  /** 记一次起坐（演示模式键盘/自动；摄像头模式由 _detectSitStand 计数） */
  _registerSitStand(now) {
    if (now - this.lastSitStandAt < CONFIG.exercise.sitStand.minRepIntervalMs) return;
    this.lastSitStandAt = now;
    this.sitStandReps++;
  }

  /* ---------------- 每帧更新（由游戏主循环调用） ---------------- */

  update(now) {
    if (this.demo) return this._updateDemo(now);

    // 摄像头模式：有新帧才推理
    if (this.landmarker && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      try {
        const res = this.landmarker.detectForVideo(this.video, now);
        this.lm = (res.landmarks && res.landmarks[0]) || null;
        this._poseSeenAt=this.lm?now:null;
        if(!this.lm) this.sm=null;
      } catch { this.lm=null;this.sm=null;this._poseSeenAt=null; }
    }
    const age=now-this._poseSeenAt;
    if(this._poseSeenAt==null || age<0 || age>(this.poseMaxAgeMs||1000)) {
      this.lm=null;this.sm=null;
      return {ok:false,mode:'camera',wrists:null,reach:defaultReach(),steps:this.steps,cadence:0,sitStand:{reps:this.sitStandReps,ok:false},legsVisible:false};
    }
    if (this.lm) this._smooth();
    return this._computeState(now);
  }

  _updateDemo(now) {
    const dt = this._lastNow ? (now - this._lastNow) / 1000 : 0;
    this._lastNow = now;
    if (this.autoWalk) {
      const spm = 106;
      this._autoStepAcc += dt * spm / 60;
      while (this._autoStepAcc >= 1) {
        this._autoStepAcc -= 1;
        this._registerStep(now, 'auto');
      }
      // 自动演示：每 4 秒一次起坐（力量小站可完整自动播放）
      this._autoSSAcc = (this._autoSSAcc || 0) + dt / 4;
      while (this._autoSSAcc >= 1) {
        this._autoSSAcc -= 1;
        this._registerSitStand(now);
      }
      // 自动挥手（展示时会自然摘到物件）
      const t = now / 1000;
      this.pointer = {
        x: 0.5 + 0.34 * Math.sin(t * 0.5),
        y: 0.42 + 0.16 * Math.sin(t * 0.83 + 1.2),
      };
    }
    this._pruneSteps(now);
    return {
      ok: true, demo: true, mode: 'demo',
      wrists: [{ ...this.pointer, vis: 1 }, { ...this.pointer, vis: 1 }],
      reach: { cx: 0.5, shoulderY: 0.38, minX: 0.12, maxX: 0.88, torso: 0.24 },
      steps: this.steps,
      cadence: this._cadence(now),
      sitStand: { reps: this.sitStandReps, ok: true },
      legsVisible: false,
    };
  }

  /** EMA 平滑关键点（x 已镜像） */
  _smooth() {
    const a = 0.45; // 平滑系数
    const pts = {};
    for (const k of ['lSh', 'rSh', 'lWr', 'rWr', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAn', 'rAn']) {
      const raw = this.lm[L[k]];
      pts[k] = { x: 1 - raw.x, y: raw.y, v: raw.visibility ?? 1 };
    }
    if (!this.sm) { this.sm = pts; return; }
    for (const k in pts) {
      this.sm[k].x += (pts[k].x - this.sm[k].x) * a;
      this.sm[k].y += (pts[k].y - this.sm[k].y) * a;
      this.sm[k].v = pts[k].v;
    }
  }

  _computeState(now) {
    if (!this.sm) {
      return {
        ok: false, mode: 'camera', wrists: null, reach: defaultReach(), steps: this.steps,
        cadence: 0, sitStand: { reps: this.sitStandReps, ok: false }, legsVisible: false,
      };
    }
    const s = this.sm;
    const shMid = { x: (s.lSh.x + s.rSh.x) / 2, y: (s.lSh.y + s.rSh.y) / 2 };
    const hipMid = { x: (s.lHip.x + s.rHip.x) / 2, y: (s.lHip.y + s.rHip.y) / 2 };
    const torso = Math.hypot(shMid.x - hipMid.x, shMid.y - hipMid.y) || 0.2;
    const ok = (s.lSh.v > 0.5 && s.rSh.v > 0.5 && s.lHip.v > 0.5 && s.rHip.v > 0.5);
    const legsVisible = ok && s.lAn.v > 0.5 && s.rAn.v > 0.5;

    if (ok) {
      if (legsVisible) this._detectStepsLegs(torso, now);
      else this._detectStepsArms(shMid, torso, now);
      this._detectSitStand(torso, now); // 坐站检测（力量小站）；膝部不可见时仅置 unavailable
    }
    this._pruneSteps(now);

    const shW = Math.abs(s.rSh.x - s.lSh.x) || 0.25;
    return {
      ok, mode: 'camera',
      wrists: [
        { x: s.lWr.x, y: s.lWr.y, vis: s.lWr.v },
        { x: s.rWr.x, y: s.rWr.y, vis: s.rWr.v },
      ],
      reach: {
        cx: shMid.x,
        shoulderY: shMid.y,
        minX: Math.max(0.08, shMid.x - shW * 1.05),
        maxX: Math.min(0.92, shMid.x + shW * 1.05),
        torso,
      },
      steps: this.steps,
      cadence: this._cadence(now),
      sitStand: { reps: this.sitStandReps, ok: this.sitStandAvailable },
      legsVisible,
    };
  }

  /** 坐站检测（力量小站）：膝角（髋-膝-踝中点向量）滞回判定，起身沿计 1 次；
   *  踝不可见（镜头偏近）时退化为髋-膝垂直高度比；膝不可见时仅置 unavailable 不计数 */
  _detectSitStand(torso, now) {
    const s = this.sm;
    const SS = CONFIG.exercise.sitStand;
    const kneeVis = s.lKnee.v > 0.5 && s.rKnee.v > 0.5;
    this.sitStandAvailable = kneeVis;
    if (!kneeVis) return;

    const hipY = (s.lHip.y + s.rHip.y) / 2;
    const kneeX = (s.lKnee.x + s.rKnee.x) / 2, kneeY = (s.lKnee.y + s.rKnee.y) / 2;
    let seated; // true=坐稳 false=站直 null=滞回区间（保持原状态）
    if (s.lAn.v > 0.5 && s.rAn.v > 0.5) {
      const anX = (s.lAn.x + s.rAn.x) / 2, anY = (s.lAn.y + s.rAn.y) / 2;
      const v1x = (s.lHip.x + s.rHip.x) / 2 - kneeX, v1y = hipY - kneeY;
      const v2x = anX - kneeX, v2y = anY - kneeY;
      const dot = v1x * v2x + v1y * v2y;
      const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1e-6;
      const ang = Math.acos(Math.min(1, Math.max(-1, dot / m))) * 180 / Math.PI;
      if (ang >= SS.standKneeAngle) seated = false;
      else if (ang <= SS.sitKneeAngle) seated = true;
      else seated = null;
    } else {
      const rel = (kneeY - hipY) / (torso || 0.2); // 站立时髋明显高于膝 → 值大
      if (rel >= SS.hipKneeRatioStand) seated = false;
      else if (rel <= SS.hipKneeRatioSit) seated = true;
      else seated = null;
    }
    if (seated === null) return;
    const prev = this.sitStandState;
    this.sitStandState = seated ? 'seated' : 'standing';
    // 起坐计数：从"坐稳"到"站直"的上升沿（Otago 计数口径），带最小间隔防抖
    if (prev === 'seated' && seated === false
      && now - this.lastSitStandAt >= SS.minRepIntervalMs) {
      this.lastSitStandAt = now;
      this.sitStandReps++;
    }
  }

  /** 腿部踏步：踝-髋垂直距离 / 躯干长度，自适应站立基线（按时间衰减，与帧率无关）+ 滞回 */
  _detectStepsLegs(torso, now) {
    const s = this.sm;
    const dt = this._lastLegTs ? Math.min(0.25, (now - this._lastLegTs) / 1000) : 0.016;
    this._lastLegTs = now;
    for (const side of ['l', 'r']) {
      const hip = s[side + 'Hip'], an = s[side + 'An'];
      const rel = (an.y - hip.y) / torso;
      // 基线跟随站立位：踏步只会让 rel 变小（取偏大值快速上抬），
      // 缓慢下探 0.09/秒，避免久站后基线漂移导致漏检
      const B = this.baseRel[side];
      this.baseRel[side] = rel > B ? rel * 0.1 + B * 0.9 : Math.max(1.2, B - 0.09 * dt);
      const lift = this.baseRel[side] - 0.24;
      const plant = this.baseRel[side] - 0.09;
      const st = this.footState[side];
      if (st === 'down' && rel < lift) this.footState[side] = 'up';
      else if (st === 'up' && rel > plant) {
        this.footState[side] = 'down';
        this._registerStep(now, side);
      }
    }
  }

  /** 摆臂后备：手越过肩上再落下 = 一步（坐姿/腿部出画时） */
  _detectStepsArms(shMid, torso, now) {
    const s = this.sm;
    for (const side of ['l', 'r']) {
      const wr = s[side + 'Wr'];
      const up = wr.y < shMid.y - torso * 0.22;
      const down = wr.y > shMid.y - torso * 0.02;
      const st = this.armState[side];
      if (st === 'down' && up) this.armState[side] = 'up';
      else if (st === 'up' && down) {
        this.armState[side] = 'down';
        this._registerStep(now, side);
      }
    }
  }

  _pruneSteps(now) {
    while (this.stepTimes.length && now - this.stepTimes[0] > 15000) this.stepTimes.shift();
  }

  _cadence(now) {
    if (!this.stepTimes.length) return 0;
    const win = Math.min(15, Math.max(8, (now - this.stepTimes[0]) / 1000));
    return Math.round(this.stepTimes.length * 60 / win);
  }

  /* ---------------- 摄像头预览（镜像视频 + 骨架） ---------------- */

  drawPreview() {
    if (this.demo || !this.preview) return;
    const ctx = this.preview.getContext('2d');
    const W = this.preview.width, H = this.preview.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (this.video.readyState >= 2) {
      ctx.translate(W, 0); ctx.scale(-1, 1); // 镜像，符合照镜子直觉
      ctx.drawImage(this.video, 0, 0, W, H);
      ctx.restore();
      if (this.lm) {
        ctx.strokeStyle = 'rgba(255,215,80,0.9)';
        ctx.lineWidth = 2;
        for (const [a, b] of CONNECTIONS) {
          const pa = this.lm[a], pb = this.lm[b];
          if (!pa || !pb) continue;
          ctx.beginPath();
          ctx.moveTo((1 - pa.x) * W, pa.y * H);
          ctx.lineTo((1 - pb.x) * W, pb.y * H);
          ctx.stroke();
        }
        for (const idx of [L.lWr, L.rWr]) {
          const p = this.lm[idx];
          if (!p) continue;
          ctx.fillStyle = 'rgba(255,80,80,0.9)';
          ctx.beginPath();
          ctx.arc((1 - p.x) * W, p.y * H, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.restore();
    }
  }
}

function defaultReach() {
  return { cx: 0.5, shoulderY: 0.38, minX: 0.12, maxX: 0.88, torso: 0.24 };
}
