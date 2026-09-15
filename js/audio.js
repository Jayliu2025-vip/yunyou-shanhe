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
    this._activeNodes=new Set(); this._sessionMuted=false; this.revision=0;
    this.ctx = null;
    this._lastSpeech = 0;
    this._zhVoice = null;
    this.isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    this.sfx = {};            // 已解码素材音效 buffer（Kenney CC0，assets/audio/）
    this._sfxPending = null;  // 加载失败的素材名单（下次 ensure 重试）
    this.onVoicesReady = null; // 设置页刷新声音下拉用

    // 预载语音列表（部分浏览器异步加载）
    try {
      const pick = () => {
        this._zhVoice = this._pickZhVoice();
        if (this.onVoicesReady) this.onVoicesReady();
      };
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
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(()=>{});
    this._loadSfx();
  }

  /** 懒加载素材音效（Kenney CC0 mp3；失败不静默——console 报告并留待下次 ensure 重试） */
  _loadSfx() {
    if (!this.ctx) return;
    const ALL = ['drop_001', 'drop_002', 'drop_003', 'pluck_001', 'pluck_002',
      'confirmation_001', 'confirmation_002', 'select_006'];
    const pending = this._sfxPending || ALL.filter(n => !this.sfx[n]);
    this._sfxPending = [];
    pending.forEach(name => {
      fetch(`assets/audio/${name}.mp3`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then(buf => this.ctx.decodeAudioData(buf))
        .then(audio => {
          this.sfx[name] = audio;
          const total = ALL.filter(n => this.sfx[n]).length;
          console.info(`[云游山河] 音效素材已加载 ${total}/${ALL.length}` + (total === ALL.length ? '（摘取/连击/里程碑/末印将使用真人感素材音）' : ''));
        })
        .catch(e => {
          console.warn('[云游山河] 音效素材加载失败，暂用合成音：', name, e.message || e);
          this._sfxPending.push(name); // 下次 ensure()（如再开一局）自动重试
        });
    });
  }

  /** 播放素材音效：rate 变调（>1 升调，消除游戏式上行音阶），gain 相对音量 */
  _sfx(name, { rate = 1, gain = 1, when = 0 } = {}) {
    const buf = this.sfx[name];
    if (!this.enabled || !buf) return false;
    try {
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const t0 = this.ctx.currentTime + when;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime((this.isMobile ? 0.85 : 0.7) * gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + buf.duration / rate);
      src.connect(g).connect(this.ctx.destination);
      this._track(src);
      src.start(t0);
      return true;
    } catch (e) { return false; }
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

  get enabled() { return this.settings.sound && this.ctx && !this._sessionMuted; }
  stopAll() {
    this._sessionMuted=true; this.revision=(this.revision||0)+1;
    try { window.speechSynthesis?.cancel(); } catch {}
    for(const node of this._activeNodes||[]) {try{node.stop();}catch{}}
    this._activeNodes?.clear();
  }
  resumeSessionAudio() { this._sessionMuted=false; this.revision=(this.revision||0)+1; }
  _track(node) { this._activeNodes.add(node); node.onended=()=>{this._activeNodes.delete(node);try{node.disconnect();}catch{}}; }


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
    this._track(osc);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /** 节拍：strong=true 为重拍（左脚），帮助玩家踩准节奏；inSync=true 时叠加亮色泛音（合拍正反馈） */
  tick(strong, inSync = false) {
    this._tone({ freq: strong ? 740 : 560, dur: strong ? 0.08 : 0.05, type: 'sine', gain: strong ? 0.14 : 0.08 });
    if (inSync) {
      // 连续合拍：节拍音加一层高八度轻泛音，"踩在点上"有更亮的声音回馈
      this._tone({ freq: strong ? 1480 : 1120, dur: 0.04, type: 'triangle', gain: 0.05 });
    }
    if (strong) this.vibrate(18);
  }

  /** 摘到物件：优先 CC0 素材（泡泡水滴感，随机三条避免重复感），无素材回退合成 */
  catchItem() {
    if (this._sfx(`drop_00${1 + Math.floor(Math.random() * 3)}`, { gain: 1 })) {
      this.vibrate(25);
      return;
    }
    this._tone({ freq: 1175, dur: 0.1, type: 'triangle', gain: 0.16, slide: 320 });
    this._tone({ freq: 1568, dur: 0.12, type: 'triangle', gain: 0.12, when: 0.07 });
    this.vibrate(25);
  }

  /**
   * 连击摘取音：CC0 弹拨素材随连击数变调上行（消除游戏式音阶），
   * 无素材回退中国五声音阶合成。只奖励"手眼协调"，与运动强度无关。
   */
  combo(n) {
    const ratios = [1, 1.122, 1.26, 1.498, 1.682]; // 相对音高（约 C D E G A）
    const idx = Math.min(ratios.length - 1, Math.max(0, n - 1));
    const evenOdd = n % 2; // 交替两条弹拨素材，音色更活泼
    if (this._sfx(`pluck_00${evenOdd + 1}`, { rate: ratios[idx], gain: 1 })) {
      this.vibrate(25);
      return;
    }
    const scale = [523.25, 587.33, 659.25, 783.99, 880.00]; // C5 D5 E5 G5 A5
    this._tone({ freq: scale[idx], dur: 0.1, type: 'triangle', gain: 0.16, slide: 200 });
    if (n >= 5) {
      this._tone({ freq: scale[idx] * 1.5, dur: 0.09, type: 'triangle', gain: 0.1, when: 0.06 });
      this._tone({ freq: scale[idx] * 2, dur: 0.12, type: 'triangle', gain: 0.08, when: 0.12 });
    }
    this.vibrate(25);
  }

  /** 里程碑（步数/里程达成）：CC0 确认音优先，回退轻快双音 */
  milestone() {
    if (this._sfx('confirmation_001', { gain: 1 })) {
      this.vibrate([20, 30, 20]);
      return;
    }
    this._tone({ freq: 784, dur: 0.14, type: 'sine', gain: 0.14 });
    this._tone({ freq: 1046.5, dur: 0.2, type: 'sine', gain: 0.14, when: 0.12 });
    this.vibrate([20, 30, 20]);
  }

  /** 本站最后一枚印章出现：CC0 选择音 ×3 变调连播（闪亮期待感），回退合成三连音 */
  finalStamp() {
    const rates = [1, 1.122, 1.26];
    let played = false;
    rates.forEach((r, i) => { played = this._sfx('select_006', { rate: r, gain: 0.9, when: i * 0.09 }) || played; });
    if (played) { this.vibrate([15, 15, 30]); return; }
    this._tone({ freq: 880, dur: 0.08, type: 'triangle', gain: 0.12 });
    this._tone({ freq: 1108.7, dur: 0.08, type: 'triangle', gain: 0.12, when: 0.08 });
    this._tone({ freq: 1318.5, dur: 0.16, type: 'triangle', gain: 0.14, when: 0.16 });
    this.vibrate([15, 15, 30]);
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

  /** 枚举可用中文语音并按名字猜测性别（不同性别患者可选男/女教练） */
  static guessGender(name) {
    const n = String(name).toLowerCase();
    if (/kangkang|yunxi|yunjian|yunyang|male|男声|david|danny|liang/.test(n)) return 'male';
    if (/xiaoxiao|xiaoyi|xiaochen|huihui|yaoyao|tingting|meijia|female|女声|tracy|hanhan|yaoyun/.test(n)) return 'female';
    return 'unknown';
  }

  listZhVoices() {
    try {
      const vs = window.speechSynthesis.getVoices();
      return (vs || []).filter(v => /^zh([-_]|$)/i.test(v.lang))
        .map(v => ({ uri: v.voiceURI, name: v.name, lang: v.lang, gender: AudioCoach.guessGender(v.name) }));
    } catch (e) { return []; }
  }

  /** 挑选中文语音：用户指定的声音 > 性别偏好（男/女教练）> 自动（优先女声） */
  _pickZhVoice(gender = null) {
    try {
      const vs = window.speechSynthesis.getVoices();
      if (!vs || !vs.length) return null;
      const zh = vs.filter(v => /^zh([-_]|$)/i.test(v.lang));
      if (!zh.length) return null;
      const want = this.settings.voiceURI;
      if (want) {
        const exact = zh.find(v => v.voiceURI === want);
        if (exact) return exact;
      }
      const prefer = gender || this.settings.voiceMode; // 'female' | 'male' | 'auto'
      if (prefer === 'male' || prefer === 'female') {
        const pool = zh.filter(v => AudioCoach.guessGender(v.name) === prefer);
        if (pool.length) return pool[0];
      }
      return zh.find(v => /xiaoxiao|xiaoyi|female|ting|mei|hui|ya/i.test(v.name))
          || zh.find(v => /CN/i.test(v.lang))
          || zh[0];
    } catch (e) { return null; }
  }

  /** 设置页变更声音偏好后调用：立即生效（下次播报用新教练声音） */
  refreshVoice() { this._zhVoice = this._pickZhVoice(); return this._zhVoice; }

  /** 中文语音提示（节流：同样的话 6 秒内不重复） */
  speak(text, force = false) {
    if (!this.settings.speech || (this._sessionMuted && !force)) return;
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
