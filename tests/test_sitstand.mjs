/**
 * 坐站检测单元测试（node 直接驱动，无需浏览器）
 * 用法：node tests/test_sitstand.mjs
 */
import { BodyInput } from '../js/pose.js';
import { CONFIG } from '../js/config.js';
import { SCENES } from '../js/scenes.js';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

const b = new BodyInput(null, null);

// 关键点构造：y 向下为正（归一化坐标，与 MediaPipe 一致）
function setPose({ hipY, kneeY, anY, hipX = 0.5, kneeX = 0.5, anX = 0.5, anVis = 1 }) {
  b.sm = {
    lSh: { x: 0.4, y: 0.2, v: 1 }, rSh: { x: 0.6, y: 0.2, v: 1 },
    lWr: { x: 0.4, y: 0.3, v: 1 }, rWr: { x: 0.6, y: 0.3, v: 1 },
    lHip: { x: hipX - 0.05, y: hipY, v: 1 }, rHip: { x: hipX + 0.05, y: hipY, v: 1 },
    lKnee: { x: kneeX - 0.05, y: kneeY, v: 1 }, rKnee: { x: kneeX + 0.05, y: kneeY, v: 1 },
    lAn: { x: anX - 0.05, y: anY, v: anVis }, rAn: { x: anX + 0.05, y: anY, v: anVis },
  };
}

console.log('== 1. 膝角判定：坐(≈90°) → 站(≈180°) 起坐计数 ==');
setPose({ hipY: 0.55, kneeY: 0.55, anY: 0.75, hipX: 0.35 });  // 坐：大腿水平小腿竖直
b._detectSitStand(0.35, 1000);
ok(b.sitStandState === 'seated', '坐姿判定 seated（膝角≈90°）');
ok(b.sitStandReps === 0, '初始坐姿不计次');
setPose({ hipY: 0.35, kneeY: 0.55, anY: 0.75 });               // 站：髋膝踝一线
b._detectSitStand(0.4, 4000);
ok(b.sitStandState === 'standing', '站姿判定 standing（膝角≈180°）');
ok(b.sitStandReps === 1, '起身沿计 1 次');

console.log('== 2. 滞回区间：膝角处于中间带时保持原状态 ==');
setPose({ hipY: 0.42, kneeY: 0.55, anY: 0.72, hipX: 0.42 });   // 抬臀中途，膝角介于 110~160
b._detectSitStand(0.38, 4500);
ok(b.sitStandState === 'standing', '滞回区保持 standing');
ok(b.sitStandReps === 1, '滞回区不计次');

console.log('== 3. 防抖：距上次计数不足 2 秒的起身沿不计数 ==');
setPose({ hipY: 0.55, kneeY: 0.55, anY: 0.75, hipX: 0.35 });   // 坐下（t=6500）
b._detectSitStand(0.35, 6500);
setPose({ hipY: 0.35, kneeY: 0.55, anY: 0.75 });               // 站起：距上次计数 2.5s（≥2s）
b._detectSitStand(0.4, 6500);
ok(b.sitStandReps === 2, '间隔 ≥2s → 计第 2 次');
setPose({ hipY: 0.55, kneeY: 0.55, anY: 0.75, hipX: 0.35 });   // 快速坐下又站起（t=7000）
b._detectSitStand(0.35, 7000);
setPose({ hipY: 0.35, kneeY: 0.55, anY: 0.75 });
b._detectSitStand(0.4, 7000);
ok(b.sitStandReps === 2, '间隔 <2s 防抖不计数');

console.log('== 4. 踝不可见：退化为髋-膝高度比判定 ==');
const repsBefore = b.sitStandReps;
setPose({ hipY: 0.55, kneeY: 0.55, anY: 0.75, hipX: 0.35, anVis: 0 }); // 坐（踝不可见，rel≈0）
b._detectSitStand(0.35, 12000);
ok(b.sitStandState === 'seated', '退化判定 seated（rel≤0.25）');
setPose({ hipY: 0.30, kneeY: 0.55, anY: 0.75, anVis: 0 });              // 站（rel=0.625）
b._detectSitStand(0.4, 16000);
ok(b.sitStandState === 'standing', '退化判定 standing（rel≥0.40）');
ok(b.sitStandReps === repsBefore + 1, '退化判定同样计起坐');

console.log('== 5. 膝不可见：置 unavailable 不计数 ==');
setPose({ hipY: 0.55, kneeY: 0.55, anY: 0.75, anVis: 0 });
b.sm.lKnee.v = 0.3; b.sm.rKnee.v = 0.3;
const st = b._computeState(20000);
ok(st.sitStand.ok === false, 'sitStand.ok=false');
setPose({ hipY: 0.35, kneeY: 0.55, anY: 0.75 });
b._detectSitStand(0.4, 21000);
ok(b.sitStandReps === repsBefore + 1, '膝不可见期间不计数');

console.log('== 6. 配置与场景完整性 ==');
const E = CONFIG.exercise;
ok(E.blockDurSec === 75 && E.blockTempo === 15 && E.repsPerStamp === 3, 'exercise 参数齐备');
ok(E.sitStand.standKneeAngle === 160 && E.sitStand.sitKneeAngle === 110, '膝角阈值');
ok(SCENES.length === 13, `SCENES.length = ${SCENES.length}`);
ok(SCENES[12].id === 'wudang' && SCENES[12].ch === '武', '第 13 景为武当仙山');
ok(typeof SCENES[12].extra === 'function', '武当山含太极图腾 extra 绘制函数');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
