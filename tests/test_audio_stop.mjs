import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioCoach} from '../js/audio.js';
test('stop cancels active and scheduled sounds and prevents late noncritical audio',()=>{
  let stopped=0,cancelled=0;
  globalThis.window={speechSynthesis:{cancel(){cancelled++;}}};
  const a=Object.assign(Object.create(AudioCoach.prototype),{settings:{sound:true,speech:true},ctx:{},_activeNodes:new Set([{stop(){stopped++;}},{stop(){stopped++;}}])});
  assert.equal(typeof a.stopAll,'function');a.stopAll();assert.equal(stopped,2);assert.equal(cancelled,1);assert.equal(Boolean(a.enabled),false);
});
