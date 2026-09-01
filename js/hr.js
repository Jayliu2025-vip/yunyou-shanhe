/**
 * 心率监测：
 *  1. 蓝牙心率带（Web Bluetooth，标准心率服务 0x180D，兼容 Polar H7/H9/H10、
 *     迪卡侬、华为等绝大多数蓝牙心率设备）
 *  2. 无蓝牙时支持手动输入（运动前后测脉搏填入）
 */

export class HRMonitor {
  constructor() {
    this.bpm = null;
    this.connected = false;
    this.deviceName = '';
    this.manual = false;
    this._device = null;
    this._server = null;
    this._char = null;
    this.onUpdate = null;   // 回调 (bpm) => void
    this.onStatus = null;   // 回调 (status) => void : 'idle'|'connecting'|'connected'|'disconnected'|'unsupported'
  }

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  _status(s) { if (this.onStatus) this.onStatus(s); }

  async connect() {
    if (!HRMonitor.supported) { this._status('unsupported'); return false; }
    this._status('connecting');
    try {
      this._device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['battery_service'],
      });
      this._device.addEventListener('gattserverdisconnected', () => {
        this.connected = false; this._status('disconnected');
      });
      this._server = await this._device.gatt.connect();
      const svc = await this._server.getPrimaryService('heart_rate');
      this._char = await svc.getCharacteristic('heart_rate_measurement');
      await this._char.startNotifications();
      this._char.addEventListener('characteristicvaluechanged', (e) => {
        const bpm = this._parseHR(e.target.value);
        if (bpm > 0) {
          this.bpm = bpm;
          this.manual = false;
          this.connected = true;
          if (this.onUpdate) this.onUpdate(bpm);
        }
      });
      this.connected = true;
      this.deviceName = this._device.name || '蓝牙心率带';
      this._status('connected');
      return true;
    } catch (e) {
      // 用户取消选择或连接失败
      this._status(e.name === 'NotFoundError' ? 'idle' : 'disconnected');
      return false;
    }
  }

  /** 解析蓝牙心率测量值（0x00 标志 → uint8，0x01 → uint16） */
  _parseHR(dv) {
    const flags = dv.getUint8(0);
    if (flags & 0x01) {
      return dv.getUint16(1, true);
    }
    return dv.getUint8(1);
  }

  /** 手动模式：患者用指测脉搏后输入 */
  setManual(bpm) {
    const v = parseInt(bpm, 10);
    if (v > 30 && v < 220) {
      this.bpm = v;
      this.manual = true;
      if (this.onUpdate) this.onUpdate(v);
    }
  }

  clearManual() {
    if (this.manual) { this.bpm = null; this.manual = false; }
  }

  /**
   * 研究设备模式：经 WebSocket 接收生理数据（如津发科技手环经其采集软件转发）。
   * 消息格式：JSON，任一字段 {bpm|hr|heart_rate|value} 为每分钟心跳数。
   */
  connectWS(url) {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this._status('unsupported'); return false; }
    this._status('connecting');
    this._ws = ws;
    ws.onopen = () => {
      this.connected = true; this.manual = false;
      this.deviceName = '研究设备（WebSocket）';
      this._status('connected');
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        const bpm = m.bpm ?? m.hr ?? m.heart_rate ?? m.value;
        if (typeof bpm === 'number' && bpm > 30 && bpm < 220) {
          this.bpm = Math.round(bpm);
          this.manual = false;
          if (this.onUpdate) this.onUpdate(this.bpm);
        }
      } catch (e) { /* 非 JSON 忽略 */ }
    };
    ws.onclose = () => { this.connected = false; this._status('disconnected'); };
    ws.onerror = () => { this.connected = false; this._status('disconnected'); };
    return true;
  }

  disconnect() {
    try { if (this._ws) this._ws.close(); } catch (e) {}
    try { if (this._char) this._char.stopNotifications(); } catch (e) {}
    try { if (this._server) this._server.disconnect(); } catch (e) {}
    this.connected = false;
    this._status('idle');
  }
}
