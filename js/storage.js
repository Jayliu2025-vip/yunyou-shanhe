/** Versioned local records. Demo, clinical and legacy never share a record bucket. */
const bucket = scope => { if(!['demo','clinical'].includes(scope)) throw new Error('Invalid record scope'); return `yysn_v2_${scope}`; };
const volatileHolds=new WeakMap();
function memoryHolds() {const storage=localStorage;if(!volatileHolds.has(storage)) volatileHolds.set(storage,new Map());return volatileHolds.get(storage);}
const holdKey = scope => bucket(scope)+'_hold';
const EMPTY_JOURNEY = {totalKm:0,sceneIndex:0,stampsInScene:0,stampsTotal:0,rounds:0};
const number = (v, fallback=0) => Number.isFinite(v)?v:fallback;
const short = v => typeof v==='string'?v.slice(0,200):null;
function load(key, fallback, strict=false) {
  try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback; }
  catch(e) { if(strict) throw e; return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key,JSON.stringify(value)); return {ok:true}; }
  catch { return {ok:false,error:'本地存储不可用或空间不足，未保存'}; }
}
function envelope(scope,strict=false) {
  const value=load(bucket(scope),null,strict);
  if(value==null) return {schemaVersion:2,sessions:[],journey:{...EMPTY_JOURNEY}};
  if(value.schemaVersion!==2 || !Array.isArray(value.sessions) || !value.journey || typeof value.journey!=='object'
    || !Object.keys(EMPTY_JOURNEY).every(k=>Number.isFinite(value.journey[k])&&value.journey[k]>=0)
    || !Number.isInteger(value.journey.sceneIndex)||value.journey.sceneIndex>=13
    || !value.sessions.every(s=>s&&typeof s.sessionId==='string'&&s.dataScope===scope)) {
    if(strict) throw new Error('Invalid record bucket');
    return {schemaVersion:2,sessions:[],journey:{...EMPTY_JOURNEY}};
  }
  return value;
}
export function getProfile(scope='demo') { return load(bucket(scope)+'_profile',{age:55,restingHr:70,weightKg:70,betaBlocker:false,pacemaker:false,mode:'standing',mainSec:900,strengthBlocks:false}); }
export function saveProfile(p,scope='demo') { return write(bucket(scope)+'_profile',p); }
export function getSettings() { return load('yysn_v2_settings',{sound:true,speech:true,autoWalkDemo:false}); }
export function saveSettings(s) { return write('yysn_v2_settings',s); }
export function getJourney(scope='clinical') { return {...EMPTY_JOURNEY,...envelope(scope).journey}; }
export function saveJourney(j,scope='clinical') { try { const e=envelope(scope,true); e.journey={...EMPTY_JOURNEY,...j}; return write(bucket(scope),e); } catch { return {ok:false,error:'无法读取进度，未覆盖原记录'}; } }
export function getSessions(scope='clinical') { return envelope(scope).sessions.filter(s=>s && s.dataScope===scope); }

export function getHold(scope='clinical') {
  try {
    const volatile=memoryHolds().get(scope);if(volatile) return volatile;
    const value=load(holdKey(scope),null,true);
    if(value!=null && (!['ACTIVE','POSTCHECK','SAFETY_STOPPED'].includes(value.state)||typeof value.sessionId!=='string')) return {state:'STORAGE_ERROR'};
    if(value) return value;
    const e=envelope(scope,true);
    const from=scope==='demo'?(e.demoClearThroughCount||0):0;
    const stopped=e.sessions.slice(from).find(s=>s.endedBy==='safety'||s.postCheck?.symptomFree===false);
    return stopped?{state:'SAFETY_STOPPED',sessionId:stopped.sessionId,reason:'recorded-safety-stop'}:null;
  } catch { return {state:'STORAGE_ERROR'}; }
}
export function beginSession(session,scope) {
  if(getHold(scope)) return {ok:false,error:'上次会话未完成或需要复核'};
  return write(holdKey(scope),{state:'ACTIVE',sessionId:session.sessionId,planId:session.planId,planVersion:session.planVersion,at:new Date().toISOString()});
}
export function lockSafety({sessionId,reason},scope) {
  const marker={state:'SAFETY_STOPPED',sessionId,reason:short(reason),at:new Date().toISOString()};
  try {memoryHolds().set(scope,marker);} catch {}
  return write(holdKey(scope),marker);
}
export function clearDemoHold() {
  try {
    const e=envelope('demo',true); e.demoClearThroughCount=e.sessions.length;
    const saved=write(bucket('demo'),e); if(!saved.ok) return saved;
    localStorage.removeItem(holdKey('demo')); memoryHolds().delete('demo'); return {ok:true};
  } catch {return {ok:false,error:'无法重置演示状态'};}
}

export function sessionSummary(s) {
  return {
    schemaVersion:2,sessionId:short(s.sessionId),dataScope:s.dataScope,activityId:'yunyou-shanhe',
    planId:short(s.planId),planVersion:short(s.planVersion),date:short(s.date),endedBy:short(s.endedBy),
    inputSource:short(s.inputSource),setting:short(s.setting),mode:short(s.mode),monitor:short(s.monitor),
    rpeScale:short(s.rpeScale),
    durationSec:{total:number(s.durationSec?.total),warmup:number(s.durationSec?.warmup),main:number(s.durationSec?.main),cooldown:number(s.durationSec?.cooldown)},
    steps:number(s.steps),stampsEarned:number(s.stampsEarned),
    rpeSamples:(s.rpeSamples||[]).filter(r=>r&&Number.isFinite(r.t)&&Number.isFinite(r.v)).map(r=>({t:r.t,v:r.v})),
    events:(s.events||[]).filter(e=>e&&['pause','resume','safety-stop','monitor-change','device-state','rpe'].includes(e.type)).map(e=>({t:number(e.t),type:e.type,reason:short(e.reason)})),
    postCheck:s.postCheck?{symptomFree:s.postCheck.symptomFree===true,at:short(s.postCheck.at)}:null,
    syncStatus:'local-only',
  };
}
function storedSession(s) {
  // Include game display metrics, but never arbitrary device payloads or raw video.
  return {...sessionSummary(s),quick:!!s.quick,scenesCompleted:number(s.scenesCompleted),distanceKm:number(s.distanceKm),avgCadence:number(s.avgCadence),maxCadence:number(s.maxCadence),itemsCaught:number(s.itemsCaught),sitStandReps:number(s.sitStandReps),blocksRun:number(s.blocksRun),strengthBlocks:!!s.strengthBlocks,kcal:Number.isFinite(s.kcal)?s.kcal:null,autoPauses:number(s.autoPauses),
    sceneNames:(s.sceneNames||[]).filter(v=>typeof v==='string').map(v=>v.slice(0,60)),
    hrAvg:Number.isFinite(s.hrAvg)?s.hrAvg:null,hrMax:Number.isFinite(s.hrMax)?s.hrMax:null,
    hrSeries:(s.hrSeries||[]).filter(v=>v&&Number.isFinite(v.t)&&Number.isFinite(v.v)).map(v=>({t:v.t,v:v.v})),
  };
}
export function commitSession(session,journey,scope='clinical') {
  if(!session?.sessionId || session.dataScope!==scope) return {ok:false,error:'记录标识或分区不一致'};
  try {
    const e=envelope(scope,true);
    if(e.sessions.some(s=>s.sessionId===session.sessionId)) return {ok:true,duplicate:true};
    const hold=getHold(scope);
    if(hold?.state==='STORAGE_ERROR'||(hold && hold.sessionId!==session.sessionId)) return {ok:false,error:'会话标记不一致，未覆盖记录'};
    const result=write(bucket(scope),{...e,schemaVersion:2,sessions:[...e.sessions,storedSession(session)],journey:{...EMPTY_JOURNEY,...journey}});
    if(!result.ok) return result;
    if(session.endedBy==='safety') {
      const locked=lockSafety({sessionId:session.sessionId,reason:'recorded-safety-stop'},scope);
      return locked.ok?{ok:true}:{ok:true,warning:'停止结果已保存；保留中断标记，继续前需复核'};
    }
    // Keep a durable barrier until postcheck is saved AND the review screen is left.
    const post=write(holdKey(scope),{state:'POSTCHECK',sessionId:session.sessionId,at:new Date().toISOString()});
    if(!post.ok) return {ok:true,warning:'结果已保存；结束后状态仍待确认，中断标记继续保留'};
    return {ok:true};
  } catch { return {ok:false,error:'记录读取失败，未覆盖原记录'}; }
}
export function savePostCheck(sessionId,symptomFree,scope='clinical') {
  if(typeof symptomFree!=='boolean') return {ok:false,error:'反馈值无效'};
  try {
    const e=envelope(scope,true),s=e.sessions.find(s=>s.sessionId===sessionId);
    if(!s) return {ok:false,error:'未找到已保存的会话，未写入反馈'};
    if((s.postCheck?.symptomFree===false || memoryHolds().get(scope)?.sessionId===sessionId) && symptomFree) return {ok:false,error:'不适反馈不能自行改为已恢复，需要复核'};
    s.postCheck={symptomFree,at:new Date().toISOString()};
    if(!symptomFree && scope==='demo') e.demoClearThroughCount=Math.min(e.demoClearThroughCount||0,e.sessions.indexOf(s));
    return write(bucket(scope),e);
  } catch {return {ok:false,error:'未能保存结束后反馈'};}
}
export function finalizeSession(sessionId,scope) {
  try {
    const hold=getHold(scope),s=envelope(scope,true).sessions.find(s=>s.sessionId===sessionId);
    if(!s || s.endedBy==='safety' || s.postCheck?.symptomFree!==true || hold?.state==='SAFETY_STOPPED' || hold?.state==='STORAGE_ERROR' || (hold && hold.sessionId!==sessionId)) return {ok:false,error:'需要完成结束后反馈或进行复核'};
    localStorage.removeItem(holdKey(scope)); return {ok:true};
  } catch {return {ok:false,error:'无法清理会话标记'};}
}
export function addSession(session,scope='clinical') { return commitSession(session,getJourney(scope),scope); }
export function participationInfo(scope='clinical') {
  const sessions=getSessions(scope), days=new Set(sessions.map(s=>s.date?.slice(0,10)).filter(Boolean));
  return {current:days.size,best:days.size,totalDays:days.size,totalSessions:sessions.length};
}
export const streakInfo=participationInfo; // Legacy function name; now counts participation days, never streak pressure.
export function lastSessionDate(scope='clinical') { return getSessions(scope).at(-1)?.date||null; }
export function exportJSON(scope='clinical') { return JSON.stringify({schemaVersion:2,dataScope:scope,journey:getJourney(scope),sessions:getSessions(scope),exportedAt:new Date().toISOString()},null,2); }
export function exportCSV(scope='clinical') {
  const escape=value=>{let s=String(value??'');if(/^[=+@-]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const rows=getSessions(scope).map(s=>[s.date,s.sessionId,s.dataScope,s.planId,s.planVersion,s.endedBy,s.inputSource,s.monitor,s.rpeScale,s.durationSec.total,s.steps,s.stampsEarned,s.hrAvg,s.hrMax,JSON.stringify(s.rpeSamples),JSON.stringify(s.events)]);
  return '\uFEFF'+['日期,会话ID,数据分区,计划ID,计划版本,结束原因,动作来源,监测方式,自评量表,总秒数,步数,印章数,心率均值,心率最大值,自评记录,事件记录',...rows.map(r=>r.map(escape).join(','))].join('\n');
}
export function exportLegacyJSON() { return JSON.stringify({dataScope:'legacy-unverified',profile:load('yysn_profile',null),journey:load('yysn_journey',null),sessions:load('yysn_sessions',[])},null,2); }
export function downloadFile(content,filename,mime='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}
export function badges(scope='clinical') {
  const sessions=getSessions(scope),j=getJourney(scope);
  return [
    {id:'first',icon:'i-sparkles',name:'迈出第一步',desc:'记录一次旅程',got:sessions.length>0},
    {id:'feedback',icon:'i-heart',name:'听见自己的节奏',desc:'如实完成一次自评',got:sessions.some(s=>s.rpeSamples?.length)},
    {id:'rest',icon:'i-leaf',name:'适时停一停',desc:'主动休息或停止也值得记录',got:sessions.some(s=>s.endedBy==='safety'||s.events?.some(e=>e.type==='pause'))},
    {id:'collection',icon:'i-book-open',name:'山河手记',desc:'收藏一枚景点纪念章',got:j.stampsTotal>0},
    {id:'round',icon:'i-compass',name:'山河相伴',desc:'完成一轮景点收集',got:j.rounds>0},
  ];
}
