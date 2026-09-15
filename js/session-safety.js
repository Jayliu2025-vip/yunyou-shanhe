/** Software state only. Clinical decisions and limits belong to a verified plan. */
export class SessionSafety {
  constructor() { this.state='READY'; this.reason=null; this.pending=new Set(); }
  start() { if(this.state!=='READY') return false; this.state='ACTIVE'; return true; }
  get terminal() { return ['SAFETY_STOPPED','COMPLETED','ENDED'].includes(this.state); }
  pause(reason) {
    if(this.terminal || this.state==='READY') return false;
    this.pending.add(reason); this.reason=reason; this.state='PAUSED'; return true;
  }
  release(reason) { if(this.terminal) return false; this.pending.delete(reason); return true; }
  resume({reviewed=false}={}) {
    if(this.state!=='PAUSED') return false;
    if(reviewed) this.pending.clear();
    if(this.pending.size) return false;
    this.state='ACTIVE'; this.reason=null; return true;
  }
  stopForSafety(reason) {
    if(this.terminal) return false;
    this.state='SAFETY_STOPPED'; this.reason=reason; this.pending.clear(); return true;
  }
  finish(completed=false) {
    if(this.terminal) return false;
    this.state=completed?'COMPLETED':'ENDED'; this.pending.clear(); return true;
  }
}

export function endSessionNotice(session,saved) {
  if(session.endedBy==='safety') return '本次已停止，不要继续本次训练。请联系康复团队复核。'+(saved?'停止结果已记录在本机。':'本次结果未保存。');
  if(!saved) return '本次已结束，但结果未保存。请保留当前页面并检查本地存储。';
  return session.dataScope==='demo'?'演示结果已记录，不计入正式康复记录。':'本次结果已记录在本机，尚未同步到医疗平台。';
}

export function frameDelta(now,previous,maxGapMs=1000) {
  const elapsed=now-previous;
  if(!Number.isFinite(elapsed)||elapsed<0) return {dt:0,reason:'clock-error'};
  if(elapsed>maxGapMs) return {dt:0,reason:'runtime-gap'};
  return {dt:elapsed/1000,reason:null};
}
