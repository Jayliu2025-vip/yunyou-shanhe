/** Heart-rate transport and quality. No medical threshold decisions here. */
export class HRMonitor {
  constructor({now=()=>performance.now()}={}) {
    this.now=now; this.generation=0; this.maxAgeMs=5000;
    this._bpm=null; this.connected=false; this.manual=false; this.source='none'; this.status='idle';
    this.deviceName=''; this.sample=null; this.lastSequence=null;
    this.onUpdate=null; this.onStatus=null;
  }
  static get supported() { return typeof navigator!=='undefined' && !!navigator.bluetooth; }
  get bpm() { return this.snapshot().bpm; }
  _status(status) { this.status=status; try { this.onStatus?.(status); } catch {} }
  beginSource(source) {
    this.disconnect();
    if(!['ble','ws'].includes(source)) throw new Error('Unsupported source');
    this.source=source; this.manual=false; this._status('connecting'); return this.generation;
  }
  acceptSample(message,token) {
    if(token!==this.generation||!['ble','ws'].includes(this.source)) return false;
    if(message?.contact===false) {this.invalidateSample('contact-lost');return false;}
    if(message?.historical===true) return false;
    if(message?.measuredAt!=null && (!Number.isFinite(Date.parse(message.measuredAt)) || Math.abs(Date.now()-Date.parse(message.measuredAt))>this.maxAgeMs)) {this.invalidateSample('invalid-sample');return false;}
    const bpm=message?.bpm, sequence=message?.sequence, t=this.now();
    if(!Number.isFinite(bpm)||bpm<=0||bpm>65535||!Number.isFinite(t)) return false;
    if(message.unit!=null && message.unit!=='bpm') return false;
    if(sequence!=null && (!Number.isSafeInteger(sequence)||sequence<0)) return false;
    if(this.lastSequence!=null && (sequence==null||sequence<=this.lastSequence)) return false;
    if(this.sample && t<this.sample.receivedAtMono) { this.sample=null; this._bpm=null; this._status('stale'); return false; }
    this.lastSequence=sequence??null; this._bpm=Math.round(bpm); this.connected=true;
    this.sample=Object.freeze({metric:'heart-rate',value:this._bpm,unit:'bpm',source:this.source,generation:token,
      receivedAtMono:t,receivedAt:new Date().toISOString(),measuredAt:typeof message.measuredAt==='string'?message.measuredAt:null,sequence:sequence??null,contact:message.contact??null});
    this._status('connected'); try { this.onUpdate?.(this._bpm); } catch {} return true;
  }
  invalidateSample(reason='invalid-sample') {this.sample=null;this._bpm=null;this._status(reason);}
  snapshot(maxAgeMs=this.maxAgeMs) {
    if(this.manual) return {ready:false,bpm:this._bpm,source:'manual',status:'manual',sample:this.sample,generation:this.generation};
    const age=this.sample?this.now()-this.sample.receivedAtMono:Infinity;
    const ready=this.connected && Number.isFinite(maxAgeMs) && maxAgeMs>0 && age>=0 && age<=maxAgeMs;
    return {ready:!!ready,bpm:ready?this._bpm:null,source:this.source,status:ready?'connected':this.sample?'stale':this.status,sample:ready?this.sample:null,generation:this.generation};
  }
  async connect() {
    if(!HRMonitor.supported) { this._status('unsupported'); return false; }
    const token=this.beginSource('ble'); let server;
    try {
      const device=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}]});
      if(token!==this.generation) return false;
      this._device=device;
      device.addEventListener('gattserverdisconnected',()=>{if(token===this.generation) this._lost(token);});
      server=await device.gatt.connect();
      if(token!==this.generation) { try { if(server!==this._server) server.disconnect(); } catch {} return false; }
      this._server=server;
      const service=await server.getPrimaryService('heart_rate');
      const char=await service.getCharacteristic('heart_rate_measurement');
      if(token!==this.generation) return false;
      this._char=char;
      char.addEventListener('characteristicvaluechanged',event=>{
        const value=this._parseHR(event.target.value);
        if(value!=null) this.acceptSample({bpm:value},token);
        else if(token===this.generation) this.invalidateSample('invalid-sample');
      });
      await char.startNotifications();
      if(token!==this.generation) return false;
      this.connected=true; this.deviceName=device.name||'心率设备'; this._status(this.sample?'connected':'waiting'); return true;
    } catch { if(token===this.generation) this._lost(token); return false; }
  }
  _parseHR(dv) {
    if(!dv || typeof dv.getUint8!=='function' || dv.byteLength<2) return null;
    const flags=dv.getUint8(0);
    if((flags&4) && !(flags&2)) return null;
    if(flags&1) return dv.byteLength>=3?dv.getUint16(1,true):null;
    return dv.getUint8(1);
  }
  setManual(value) {
    const bpm=Number(value); if(!Number.isFinite(bpm)||bpm<=0||bpm>65535) return false;
    this.disconnect(); this.manual=true; this.source='manual'; this._bpm=Math.round(bpm);
    this.sample={metric:'heart-rate',value:this._bpm,unit:'bpm',source:'manual',receivedAt:new Date().toISOString()};
    this._status('manual'); return true;
  }
  clearManual() { if(this.manual) this.disconnect(); }
  connectWS(url) {
    let parsed; try { parsed=new URL(url); } catch { return false; }
    if(!['ws:','wss:'].includes(parsed.protocol)||parsed.username||parsed.password) return false;
    if(parsed.protocol==='ws:' && !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) return false;
    const token=this.beginSource('ws'); let ws;
    try { ws=new WebSocket(parsed.href); } catch { this._lost(token); return false; }
    this._ws=ws;
    ws.onopen=()=>{if(token!==this.generation) return; this.connected=true;this.deviceName='研究网关';this._status('waiting');};
    ws.onmessage=event=>{if(token!==this.generation || typeof event.data!=='string' || event.data.length>4096) return;
      try { const m=JSON.parse(event.data); this.acceptSample({bpm:m.bpm??m.hr??m.heart_rate,sequence:m.sequence,unit:m.unit,contact:m.contact,measuredAt:m.measuredAt,historical:m.historical},token); } catch {} };
    ws.onclose=()=>this._lost(token); ws.onerror=()=>this._lost(token); return true;
  }
  _lost(token) { if(token!==this.generation) return; this.disconnect(); this._status('disconnected'); }
  disconnect() {
    ++this.generation;
    const ws=this._ws, char=this._char, server=this._server;
    this._ws=null;this._char=null;this._server=null;this._device=null;
    this.connected=false;this.manual=false;this.source='none';this.sample=null;this._bpm=null;this.lastSequence=null;this.deviceName='';
    try { ws?.close(); } catch {}
    try { Promise.resolve(char?.stopNotifications()).catch(()=>{}); } catch {}
    try { server?.disconnect(); } catch {}
    this._status('idle');
  }
}
