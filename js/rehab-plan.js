/** Plan provenance is supplied by the host's trusted adapter, never by URL/JSON flags. */
const issued = new WeakSet();
const supportedScale = 'project-0-10-v1';
const finitePositive = v => typeof v==='number' && Number.isFinite(v) && v>0;
const freeze = obj => { Object.values(obj).forEach(v=>{if(v && typeof v==='object') freeze(v);}); return Object.freeze(obj); };
const text = v => typeof v==='string' && v.length>0 && v.length<=200;

export function validateRehabPlan(p, now=Date.now()) {
  const errors=[];
  if(!p || typeof p!=='object') return {ok:false,errors:['缺少计划']};
  if(!['demo','clinical'].includes(p.scope)) errors.push('计划模式无效');
  if(!text(p.id)||!text(p.version)) errors.push('缺少计划标识或版本');
  for(const field of ['warmupSec','mainSec','cooldownSec','tempoMin','tempoStart','tempoMax','warmupTempo','cooldownTempo','rpePromptIntervalSec','sampleMaxAgeMs','tempoDownStep']) {
    if(!finitePositive(p[field])) errors.push(`无效计划字段：${field}`);
  }
  if(!(p.tempoMin<=p.tempoStart && p.tempoStart<=p.tempoMax)) errors.push('节奏范围冲突');
  if(p.rpeScale!==supportedScale) errors.push('当前版本不支持该量表，不能自动换算');
  if(!Number.isFinite(p.rpeTargetHigh)||p.rpeTargetHigh<0||p.rpeTargetHigh>10) errors.push('自评范围无效');
  if(!Number.isFinite(p.rpePauseAt)||p.rpePauseAt<=p.rpeTargetHigh||p.rpePauseAt>10) errors.push('自评暂停设置无效');
  if(!['standing','seated'].includes(p.mode)||!['home','clinic'].includes(p.setting)) errors.push('姿势或场景无效');
  if(typeof p.requiredHr!=='boolean'||typeof p.allowHrFallback!=='boolean') errors.push('缺少设备策略');
  if(p.hrStopAbove!=null && (!finitePositive(p.hrStopAbove)||!finitePositive(p.hrOverLimitSec))) errors.push('心率停止规则无效');
  if(p.hrZone!=null && (!finitePositive(p.hrZone.low)||!finitePositive(p.hrZone.high)||p.hrZone.low>=p.hrZone.high)) errors.push('心率目标范围无效');
  if(p.scope==='clinical') {
    if(p.status!=='active'||!text(p.signedBy)||!['II','III'].includes(p.rehabPhase)) errors.push('缺少有效签发或阶段');
    if(!Number.isFinite(Date.parse(p.signedAt))||Date.parse(p.signedAt)>now) errors.push('签发日期无效');
    if(!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now) errors.push('计划已到期');
    if(!Number.isFinite(Date.parse(p.reviewDueAt))||Date.parse(p.reviewDueAt)<=now) errors.push('需要复核计划');
    // The current motor only implements basic stepping. Do not approximate clinical resistance plans.
    if(p.strengthBlocks!==false) errors.push('当前版本尚不执行正式力量处方');
    if(p.quick) errors.push('正式计划不能使用快速演示时长');
  }
  return {ok:errors.length===0,errors};
}

export function createDemoPlan({quick=false,mainSec=900,mode='standing',strengthBlocks=false}={}) {
  const p={
    id:'DEMO-ONLY',version:'demo-v1.4.0',scope:'demo',status:'demo',rehabPhase:null,
    warmupSec:quick?20:300,mainSec:quick?90:mainSec,cooldownSec:quick?20:300,
    warmupTempo:80,cooldownTempo:70,tempoMin:60,tempoStart:80,tempoMax:80,tempoDownStep:8,
    // These are explicit demonstration parameters, not a patient prescription.
    rpeScale:supportedScale,rpeTargetHigh:4,rpePauseAt:6,rpePromptIntervalSec:quick?30:180,
    requiredHr:false,allowHrFallback:true,sampleMaxAgeMs:5000,
    hrZone:null,hrStopAbove:null,hrOverLimitSec:null,mode,setting:'home',quick:!!quick,strengthBlocks:!!strengthBlocks,
  };
  const result=validateRehabPlan(p);
  if(!result.ok) throw new Error(result.errors.join('；'));
  freeze(p); issued.add(p); return p;
}

export function canStartPlan(p, now=Date.now()) {
  const result=validateRehabPlan(p,now);
  if(!p || !issued.has(p)) return {ok:false,errors:[...result.errors,'计划来源尚未验证']};
  return result;
}

export class PlanGateway {
  constructor({fetchPlan=null,verifyPlan=null}={}) { this.fetchPlan=fetchPlan; this.verifyPlan=verifyPlan; this.revision=0; }
  async load() {
    const revision=++this.revision;
    if(!this.fetchPlan||!this.verifyPlan) return {ok:false,errors:['尚未接入可信康复计划服务']};
    try {
      const p=freeze(JSON.parse(JSON.stringify(await this.fetchPlan())));
      if(await this.verifyPlan(p)!==true || revision!==this.revision) return {ok:false,errors:['计划来源验证未通过']};
      if(p.scope!=='clinical') return {ok:false,errors:['正式计划类型无效']};
      const result=validateRehabPlan(p);
      if(!result.ok) return result;
      freeze(p); issued.add(p); return {ok:true,plan:p};
    } catch { return {ok:false,errors:['无法获取或验证计划，请联系康复团队']}; }
  }
}

export function checkPreflight({symptomFree,notOnHold,spaceReady,plan,hrReady,bodyReady}) {
  const errors=[...canStartPlan(plan).errors];
  if(symptomFree!==true) errors.push('存在不适或尚未确认当前状态');
  if(notOnHold!==true) errors.push('尚未确认未被要求暂停运动');
  if(spaceReady!==true) errors.push('请确认活动空间与手机摆放');
  if(bodyReady!==true) errors.push('输入尚未准备就绪');
  if(plan?.requiredHr && hrReady!==true) errors.push('计划要求的实时心率数据尚未就绪');
  return {ok:errors.length===0,errors};
}
