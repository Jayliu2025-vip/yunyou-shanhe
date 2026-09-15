import test from 'node:test';
import assert from 'node:assert/strict';
const mod = async p => import(p).catch(e => { if(e.code==='ERR_MODULE_NOT_FOUND') return {}; throw e; });
const states=await mod('../js/session-safety.js');
const plans=await mod('../js/rehab-plan.js');
function controller() { assert.equal(typeof states.SessionSafety,'function'); const s=new states.SessionSafety(); s.start(); return s; }
test('safety stop is absorbing across pause, review and finish calls',()=>{
  const s=controller(); s.pause('rpe'); s.stopForSafety('symptom');
  s.release('rpe'); s.resume({reviewed:true}); s.finish();
  assert.equal(s.state,'SAFETY_STOPPED'); assert.equal(s.reason,'symptom');
});
test('closing an informational pause cannot clear a different pause',()=>{
  const s=controller(); s.pause('scene-intro'); s.pause('background'); s.release('scene-intro');
  assert.equal(s.resume(),false); assert.equal(s.state,'PAUSED');
});
test('normal pauses require explicit completed review',()=>{
  const s=controller(); s.pause('manual'); assert.equal(s.resume(),false);
  assert.equal(s.resume({reviewed:true}),true); assert.equal(s.state,'ACTIVE');
});
test('ended sessions reject new pause, resume and start operations',()=>{
  const s=controller(); s.finish(); s.pause('manual'); assert.equal(s.resume({reviewed:true}),false); assert.equal(s.start(),false);
});
test('signed-looking JSON never becomes a verified clinical plan',()=>{
  assert.equal(typeof plans.canStartPlan,'function'); assert.equal(plans.canStartPlan({scope:'clinical',status:'active',signedBy:'someone'}).ok,false);
});
test('demo plan has explicit provenance and no generated clinical heart-rate target',()=>{
  assert.equal(typeof plans.createDemoPlan,'function'); const p=plans.createDemoPlan({quick:true});
  assert.equal(p.scope,'demo'); assert.equal(p.hrZone,null); assert.equal(p.strengthBlocks,false);
  assert.equal(plans.canStartPlan(p).ok,true); assert.equal(Object.isFrozen(p),true);
});
test('a copied demo plan cannot bypass plan provenance checks',()=>{
  assert.equal(typeof plans.createDemoPlan,'function'); const p=plans.createDemoPlan();
  assert.equal(plans.canStartPlan(JSON.parse(JSON.stringify(p))).ok,false);
});
test('default gateway makes no network requests and rejects formal training',async()=>{
  assert.equal(typeof plans.PlanGateway,'function'); const result=await new plans.PlanGateway().load(); assert.equal(result.ok,false);
});
test('gateway refuses failed verification',async()=>{
  assert.equal(typeof plans.PlanGateway,'function');
  const g=new plans.PlanGateway({fetchPlan:async()=>({scope:'clinical'}),verifyPlan:async()=>false});
  assert.equal((await g.load()).ok,false);
});
test('plan schema rejects unsupported scales and contradictory intensity ranges',()=>{
  assert.equal(typeof plans.validateRehabPlan,'function'); const p=plans.createDemoPlan();
  for(const patch of [{rpeScale:'borg-6-20'},{tempoMin:120,tempoStart:90},{mainSec:NaN},{sampleMaxAgeMs:0}]) {
    assert.equal(plans.validateRehabPlan({...p,...patch}).ok,false);
  }
});
test('end notices never promise saved data after write failure or resumption after safety stop',()=>{
  assert.equal(typeof states.endSessionNotice,'function');
  const failed=states.endSessionNotice({endedBy:'user'},false);assert(!failed.includes('已记录'));assert(failed.includes('未保存'));
  const stopped=states.endSessionNotice({endedBy:'safety'},true);assert(!stopped.includes('明天继续'));assert(stopped.includes('复核'));
});
test('elapsed-time calculation preserves slow frames and pauses on clock faults',()=>{
  assert.equal(typeof states.frameDelta,'function');
  assert.equal(states.frameDelta(1200,1000).dt,.2);
  assert.equal(states.frameDelta(900,1000).reason,'clock-error');
  assert.equal(states.frameDelta(3001,1000).reason,'runtime-gap');
});
test('gateway verifies a snapshot that cannot change during an asynchronous check',async()=>{
  const now=Date.now(),base=plans.createDemoPlan();
  const raw={...base,scope:'clinical',status:'active',signedBy:'synthetic-reviewer',rehabPhase:'III',signedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),reviewDueAt:new Date(now+60000).toISOString()};
  const g=new plans.PlanGateway({fetchPlan:async()=>raw,verifyPlan:async()=>{raw.mainSec=10000;return true;}});
  const result=await g.load();assert.equal(result.ok,true);assert.equal(result.plan.mainSec,base.mainSec);
});
