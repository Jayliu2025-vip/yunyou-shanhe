/**
 * 音频教练：WebAudio 合成音效（节拍/叮咚/盖印章/阶段提示）+ 中文语音提示 + 手机震动反馈
 * 不依赖任何音频文件，全部程序合成，离线可用。
 *
 * v2 强化（针对手机端）：
 *  - bindUnlock()：首次触摸/点击即解锁音频（绕过移动端自动播放限制）
 *  - 语音优先挑选中文女声，语速音量按移动端调校
 *  - 关键事件（摘取/盖章/警报/锣声）同步触发 navigator.vibrate 触感反馈
 */

export class AudioCoach {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this._lastSpeech = 0;
    this._zhVoice = null;
    this.isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

    // 预载语音列表（部分浏览器异步加载）
    try {
      const pick = () => { this._zhVoice = this._pickZhVoice(); };
      pick();
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pick;
    } catch (e) { /* 忽略 */ }
  }

  /** 需在用户手势中调用一次（浏览器自动播放策略） */
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { console.warn('音频初始化失败', e); }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * 手机端音频解锁：挂在 document 上，首次任意触摸/点击即初始化。
   * 只需调用一次，内部自动移除监听。
   */
  bindUnlock() {
    const unlock = () => {
      this.ensure();
      // iOS 的 speechSynthesis 也需要在用户手势里"热身"
      if (this.settings.speech) {
        try {
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0; u.lang = 'zh-CN';
          window.speechSynthesis.speak(u);
        } catch (e) { /* 忽略 */ }
      }
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
  }

  get enabled() { return this.settings.sound && this.ctx; }

  /** 触感反馈（手机）：pattern 为毫秒或数组；桌面端自动忽略 */
  vibrate(pattern) {
    if (!this.settings.sound) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 忽略 */ }
  }

  _tone({ freq = 880, dur = 0.09, type = 'sine', gain = 0.18, when = 0, slide = 0 }) {
    if (!this.enabled) return;
    // 手机扬声器高频偏弱，整体略增音量
    const g0 = this.isMobile ? gain * 1.25 : gain;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(g0, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /** 节拍：strong=true 为重拍（左脚），帮助玩家踩准节奏 */
  tick(strong) {
    this._tone({ freq: strong ? 740 : 560, dur: strong ? 0.08 : 0.05, type: 'sine', gain: strong ? 0.14 : 0.08 });
    if (strong) this.vibrate(18);
  }

  /** 摘到物件 */
  catchItem() {
    this._tone({ freq: 1175, dur: 0.1, type: 'triangle', gain: 0.16, slide: 320 });
    this._tone({ freq: 1568, dur: 0.12, type: 'triangle', gain: 0.12, when: 0.07 });
    this.vibrate(25);
  }

  /** 收入一枚印章 */
  stamp() {
    this._tone({ freq: 392, dur: 0.5, type: 'sine', gain: 0.2 });
    this._tone({ freq: 587, dur: 0.45, type: 'sine', gain: 0.15, when: 0.02 });
    this._tone({ freq: 784, dur: 0.4, type: 'triangle', gain: 0.1, when: 0.04 });
    this.vibrate([30, 40, 30]);
  }

  /** 景点集齐（盖章仪式） */
  gong() {
    this._tone({ freq: 220, dur: 1.4, type: 'sine', gain: 0.25 });
    this._tone({ freq: 330, dur: 1.2, type: 'sine', gain: 0.12, when: 0.03 });
    this._tone({ freq: 660, dur: 0.8, type: 'triangle', gain: 0.08, when: 0.06 });
    this._tone({ freq: 880, dur: 0.6, type: 'triangle', gain: 0.06, when: 0.12 });
    this.vibrate([80, 60, 80, 60, 160]);
  }

  /** 阶段切换 */
  chime() {
    this._tone({ freq: 659, dur: 0.16, type: 'sine', gain: 0.14 });
    this._tone({ freq: 880, dur: 0.2, type: 'sine', gain: 0.14, when: 0.13 });
  }

  /** 安全提醒（心率超限） */
  warn() {
    this._tone({ freq: 440, dur: 0.22, type: 'square', gain: 0.08 });
    this._tone({ freq: 440, dur: 0.22, type: 'square', gain: 0.08, when: 0.3 });
    this.vibrate([120, 80, 120]);
  }

  /** 暂停 / 继续小提示音 */
  pauseCue() {
    this._tone({ freq: 520, dur: 0.12, type: 'sine', gain: 0.1 });
    this._tone({ freq: 392, dur: 0.14, type: 'sine', gain: 0.09, when: 0.1 });
  }
  resumeCue() {
    this._tone({ freq: 392, dur: 0.1, type: 'sine', gain: 0.09 });
    this._tone({ freq: 587, dur: 0.14, type: 'sine', gain: 0.1, when: 0.09 });
    this.vibrate(20);
  }

  /** 挑选中文语音（优先女声 / 高质量在线语音） */
  _pickZhVoice() {
    try {
      const vs = window.speechSynthesis.getVoices();
      if (!vs || !vs.length) return null;
      const zh = vs.filter(v => /^zh([-_]|$)/i.test(v.lang));
      if (!zh.length) return null;
      return zh.find(v => /xiaoxiao|xiaoyi|female|ting|mei|hui|ya/i.test(v.name))
          || zh.find(v => /CN/i.test(v.lang))
          || zh[0];
    } catch (e) { return null; }
  }

  /** 中文语音提示（节流：同样的话 6 秒内不重复） */
  speak(text, force = false) {
    if (!this.settings.speech) return;
    const now = performance.now();
    if (!force && now - this._lastSpeech < 6000 && this._lastText === text) return;
    this._lastSpeech = now; this._lastText = text;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (!this._zhVoice) this._zhVoice = this._pickZhVoice();
      if (this._zhVoice) u.voice = this._zhVoice;
      u.rate = 0.95;
      u.pitch = 1.05;
      u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* 语音不可用时静默 */ }
  }
}
