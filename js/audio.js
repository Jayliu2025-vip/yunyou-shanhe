/**
 * 音频教练：WebAudio 合成音效（节拍/叮咚/盖印章/阶段提示）+ 中文语音提示
 * 不依赖任何音频文件，全部程序合成，离线可用。
 */

export class AudioCoach {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this._lastSpeech = 0;
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

  get enabled() { return this.settings.sound && this.ctx; }

  _tone({ freq = 880, dur = 0.09, type = 'sine', gain = 0.18, when = 0, slide = 0 }) {
    if (!this.enabled) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /** 节拍：strong=true 为重拍（左脚），帮助玩家踩准节奏 */
  tick(strong) {
    this._tone({ freq: strong ? 740 : 560, dur: strong ? 0.08 : 0.05, type: 'sine', gain: strong ? 0.14 : 0.08 });
  }

  /** 摘到物件 */
  catchItem() {
    this._tone({ freq: 1175, dur: 0.1, type: 'triangle', gain: 0.16, slide: 320 });
    this._tone({ freq: 1568, dur: 0.12, type: 'triangle', gain: 0.12, when: 0.07 });
  }

  /** 收入一枚印章 */
  stamp() {
    this._tone({ freq: 392, dur: 0.5, type: 'sine', gain: 0.2 });
    this._tone({ freq: 587, dur: 0.45, type: 'sine', gain: 0.15, when: 0.02 });
    this._tone({ freq: 784, dur: 0.4, type: 'triangle', gain: 0.1, when: 0.04 });
  }

  /** 景点集齐（盖章仪式） */
  gong() {
    this._tone({ freq: 220, dur: 1.4, type: 'sine', gain: 0.25 });
    this._tone({ freq: 330, dur: 1.2, type: 'sine', gain: 0.12, when: 0.03 });
    this._tone({ freq: 660, dur: 0.8, type: 'triangle', gain: 0.08, when: 0.06 });
    this._tone({ freq: 880, dur: 0.6, type: 'triangle', gain: 0.06, when: 0.12 });
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
      u.rate = 0.92; u.pitch = 1; u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* 语音不可用时静默 */ }
  }
}
