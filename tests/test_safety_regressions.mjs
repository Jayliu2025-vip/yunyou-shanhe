import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Image = class { set src(v) {} };
const { Game } = await import('../js/game.js');
const { HRMonitor } = await import('../js/hr.js');
const store = await import('../js/storage.js');
const {BodyInput}=await import('../js/pose.js');
const {createDemoPlan}=await import('../js/rehab-plan.js');
const stateModule = await import('../js/session-safety.js').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const audio = new Proxy({}, { get: () => () => {} });
function game() {
  const g = Object.assign(Object.create(Game.prototype), { running:true, paused:true, pauseReason:'rpe', phase:'main', simTime:10, tempo:104, rpeSamples:[], events:[], audio, plan:{strengthBlocks:false, rpeTargetHigh:4}, _showPhaseTitle(){}, onEvent(){}, body:{steps:0}, _lastFrame:0 });
  if (stateModule.SessionSafety) { g.safety = new stateModule.SessionSafety(); g.safety.start(); g.safety.pause('rpe'); }
  return g;
}

test('low perceived exertion never automatically increases load', () => {
  const g=game(); g.answerRpe(2); assert.equal(g.tempo,104);
});
test('hard fatigue while a self-report dialog is open retains a distinct pause reason', () => {
  const g=game(); g.answerRpe(6); assert.equal(g.pauseReason,'rpe-hard'); assert.equal(g.paused,true);
});
test('a symptom stop rejects every later resume and self-report', () => {
  const g=game(); assert.equal(typeof g.safetyStop,'function'); g.safetyStop('symptom');
  g.resume(); g.answerRpe(1); assert.equal(g.paused,true); assert.equal(g.safety.state,'SAFETY_STOPPED');
});
test('truncated BLE notifications are rejected without throwing', () => {
  const hr=new HRMonitor(); assert.doesNotThrow(()=>hr._parseHR(new DataView(new ArrayBuffer(1))));
});
test('switching to a manual reading invalidates a live source', () => {
  const hr=new HRMonitor(); hr.connected=true; hr.setManual(80); assert.equal(hr.connected,false); assert.equal(hr.manual,true);
});
test('demo sessions never appear in clinical records', () => {
  const data=new Map(); globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  store.addSession({sessionId:'demo-test',dataScope:'demo',date:new Date().toISOString(),durationSec:{total:10},events:[]},'demo');
  assert.equal(store.getSessions('clinical').length,0);
  assert.equal(store.getSessions('demo').length,1);
});
test('a failed write is reported instead of silently claiming a saved session', () => {
  globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}};
  const result=store.addSession({sessionId:'demo-quota',dataScope:'demo'},'demo'); assert.equal(result.ok,false);
});
test('a frozen camera frame cannot keep reporting a valid body',()=>{
  const b=Object.assign(Object.create(BodyInput.prototype),{demo:false,landmarker:null,video:{readyState:2,currentTime:1},lastVideoTime:1,lm:{},sm:{},steps:0,sitStandReps:0,_poseSeenAt:1000,poseMaxAgeMs:1000,_smooth(){},_computeState(){return {ok:true};}});
  assert.equal(b.update(3001).ok,false);
});
test('a real Game instance can be constructed before its plan is assigned',()=>{
  globalThis.window={addEventListener(){}};
  assert.doesNotThrow(()=>new Game({canvas:{getContext:()=>({})},body:{},hr:new HRMonitor(),audio,profile:{},journey:{sceneIndex:0},settings:{}}));
});
test('explicit phone fallback invalidates the old device connection',()=>{
  let t=1000;const h=new HRMonitor({now:()=>t}),token=h.beginSource('ws');h.acceptSample({bpm:80},token);t=7000;
  const g=game();g.plan=createDemoPlan();g.hr=h;g.monitor='hr';g.bodyState={mode:'demo',ok:true};g.safety.pause('device-lost');
  assert.equal(g.resume({reviewed:true,symptomFree:true,talkComfortable:true,rpe:2,usePhone:true}),true);
  assert.equal(h.acceptSample({bpm:90},token),false);assert.equal(g.monitor,'rpe');
});
