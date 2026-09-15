import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
function setup(){const m=new Map();globalThis.localStorage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};return m;}
const record=id=>({sessionId:id,dataScope:'demo',date:'2026-09-15T00:00:00Z',planId:'DEMO-ONLY',planVersion:'v1',durationSec:{total:10},events:[],stampsEarned:1});
test('a safety hold survives a completed report and another page instance',()=>{setup();assert.equal(typeof store.beginSession,'function');store.beginSession(record('a'),'demo');store.lockSafety({sessionId:'a',reason:'symptom'},'demo');store.commitSession(record('a'),{stampsTotal:1},'demo');assert.equal(store.getHold('demo').state,'SAFETY_STOPPED');});
test('an unfinished session blocks a new start, rather than silently resuming',()=>{setup();assert.equal(typeof store.beginSession,'function');assert.equal(store.beginSession(record('a'),'demo').ok,true);assert.equal(store.beginSession(record('b'),'demo').ok,false);});
test('session and journey commit together, duplicate reports do not duplicate rewards',()=>{setup();assert.equal(typeof store.commitSession,'function');assert.equal(store.commitSession(record('a'),{stampsTotal:1},'demo').ok,true);store.commitSession(record('a'),{stampsTotal:2},'demo');assert.equal(store.getSessions('demo').length,1);assert.equal(store.getJourney('demo').stampsTotal,1);});
test('quota failure retains the activity marker and old journey',()=>{setup();assert.equal(typeof store.beginSession,'function');store.beginSession(record('a'),'demo');localStorage.setItem=()=>{throw new Error('quota');};assert.equal(store.commitSession(record('a'),{stampsTotal:2},'demo').ok,false);assert.equal(store.getSessions('demo').length,0);assert.equal(store.getHold('demo').state,'ACTIVE');});
test('legacy data is preserved without classifying it as a clinical record',()=>{const m=setup();m.set('yysn_sessions',JSON.stringify([record('legacy')]));assert.equal(store.getSessions('clinical').length,0);assert.equal(m.has('yysn_sessions'),true);});
test('result contract excludes arbitrary payloads and direct identifiers',()=>{setup();assert.equal(typeof store.sessionSummary,'function');const summary=store.sessionSummary({...record('a'),name:'DO-NOT-EXPORT',cameraVideo:'DO-NOT-EXPORT',metadata:{secret:'DO-NOT-EXPORT'}});assert(!JSON.stringify(summary).includes('DO-NOT-EXPORT'));assert.equal(summary.sessionId,'a');});
test('post-session feedback is attached to the matching session only',()=>{setup();assert.equal(typeof store.savePostCheck,'function');store.commitSession(record('a'),{},'demo');assert.equal(store.savePostCheck('missing',true,'demo').ok,false);assert.equal(store.savePostCheck('a',false,'demo').ok,true);assert.equal(store.getSessions('demo')[0].postCheck.symptomFree,false);});
test('a recovered record write never clears a symptom stop whose marker write failed',()=>{setup();store.beginSession(record('a'),'demo');const write=localStorage.setItem;localStorage.setItem=()=>{throw new Error('quota');};store.lockSafety({sessionId:'a',reason:'symptom'},'demo');localStorage.setItem=write;store.commitSession({...record('a'),endedBy:'safety'}, {},'demo');assert(store.getHold('demo'));});
test('negative postcheck itself blocks restart even when a separate hold write failed',()=>{setup();store.commitSession(record('a'),{},'demo');store.savePostCheck('a',false,'demo');assert(store.getHold('demo'));assert.equal(store.savePostCheck('a',true,'demo').ok,false);assert(store.getHold('demo'));});
test('explicit demo reset leaves negative history intact while allowing another demo',()=>{setup();store.commitSession({...record('a'),endedBy:'safety'}, {},'demo');assert(store.getHold('demo'));store.clearDemoHold();assert.equal(store.getHold('demo'),null);assert.equal(store.getSessions('demo')[0].endedBy,'safety');});
test('corrupt progress blocks a new session without overwriting the old bucket',()=>{const m=setup();const raw=JSON.stringify({schemaVersion:2,sessions:[],journey:{sceneIndex:99,totalKm:'bad'}});m.set('yysn_v2_demo',raw);assert.equal(store.beginSession(record('a'),'demo').ok,false);assert.equal(m.get('yysn_v2_demo'),raw);});
test('post-session write failure retains durable blocking after a page reload',async()=>{
  setup();store.beginSession(record('a'),'demo');store.commitSession({...record('a'),endedBy:'user'}, {},'demo');
  const write=localStorage.setItem;localStorage.setItem=()=>{throw new Error('quota');};
  store.lockSafety({sessionId:'a',reason:'post-session-symptom'},'demo');store.savePostCheck('a',false,'demo');localStorage.setItem=write;
  const fresh=await import('../js/storage.js?reload-post-failure');assert(fresh.getHold('demo'));assert.equal(fresh.beginSession(record('b'),'demo').ok,false);
});
test('positive postcheck is finalized only on leaving the review screen',()=>{
  setup();assert.equal(typeof store.finalizeSession,'function');store.beginSession(record('a'),'demo');store.commitSession(record('a'),{},'demo');store.savePostCheck('a',true,'demo');assert(store.getHold('demo'));assert.equal(store.finalizeSession('a','demo').ok,true);assert.equal(store.getHold('demo'),null);
});
test('a later failed symptom write blocks finalizing an earlier positive postcheck',()=>{
  setup();assert.equal(typeof store.finalizeSession,'function');store.beginSession(record('a'),'demo');store.commitSession(record('a'),{},'demo');store.savePostCheck('a',true,'demo');
  const write=localStorage.setItem;localStorage.setItem=()=>{throw new Error('quota');};store.lockSafety({sessionId:'a',reason:'symptom'},'demo');localStorage.setItem=write;assert.equal(store.finalizeSession('a','demo').ok,false);assert(store.getHold('demo'));
});
