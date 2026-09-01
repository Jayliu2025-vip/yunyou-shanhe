/**
 * 十二景 · 云游中国
 * 每个景点：专属配色 + 标志性剪影（塔/驼队/长城/宫殿……），全部用 Canvas 程序化绘制。
 * 视差滚动由累计里程驱动，配合踏步节奏产生"行走于山河之间"的感受。
 */

export const PXKM = 80000; // 视觉像素/公里：中等步频下约 100px/s，接近真实步行体感

/* ---------------- 颜色工具 ---------------- */

function hex2rgb(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function mixColor(c1, c2, t) {
  const a = hex2rgb(c1), b = hex2rgb(c2);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

/* ---------------- 剪影绘制辅助 ---------------- */

// 宝塔（雷峰塔/三塔通用）：tier 层数
function pagoda(ctx, x, y, s, c, tiers = 5) {
  ctx.fillStyle = c;
  let w = s * 1.1, h = s * 0.32;
  let cy = y;
  for (let i = 0; i < tiers; i++) {
    // 檐
    ctx.beginPath();
    ctx.moveTo(x - w / 2, cy);
    ctx.quadraticCurveTo(x - w / 2 - s * 0.12, cy - h * 0.35, x - w / 2 - s * 0.05, cy - h * 0.5);
    ctx.lineTo(x + w / 2 + s * 0.05, cy - h * 0.5);
    ctx.quadraticCurveTo(x + w / 2 + s * 0.12, cy - h * 0.35, x + w / 2, cy);
    ctx.closePath(); ctx.fill();
    // 塔身
    const bw = w * 0.62;
    ctx.fillRect(x - bw / 2, cy - h * 1.6, bw, h * 1.6);
    cy -= h * 1.6;
    w *= 0.82;
  }
  ctx.fillRect(x - s * 0.03, cy - s * 0.22, s * 0.06, s * 0.22); // 塔刹
}

// 迎客松：歪干 + 平展枝
function pine(ctx, x, y, s, c) {
  ctx.strokeStyle = c; ctx.fillStyle = c;
  ctx.lineWidth = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + s * 0.1, y - s * 0.5, x - s * 0.12, y - s * 0.95);
  ctx.stroke();
  const canopies = [
    [x - s * 0.55, y - s * 0.75, s * 0.4], [x + s * 0.35, y - s * 0.85, s * 0.45],
    [x - s * 0.1, y - s * 1.05, s * 0.42],
  ];
  for (const [cx, cyy, r] of canopies) {
    ctx.beginPath();
    ctx.ellipse(cx, cyy, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 桂林喀斯特峰
function karst(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.55, y);
  ctx.bezierCurveTo(x - s * 0.5, y - s * 0.9, x - s * 0.18, y - s * 1.5, x - s * 0.05, y - s * 1.55);
  ctx.bezierCurveTo(x + s * 0.1, y - s * 1.5, x + s * 0.42, y - s * 0.8, x + s * 0.55, y);
  ctx.closePath(); ctx.fill();
}

// 张家界石柱
function pillar(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  const w = s * 0.34;
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.lineTo(x - w * 0.8, y - s * 1.6);
  ctx.quadraticCurveTo(x, y - s * 1.85, x + w * 0.8, y - s * 1.6);
  ctx.lineTo(x + w, y);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); // 柱顶植被
  ctx.ellipse(x, y - s * 1.68, w * 0.95, w * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 敦煌驼队
function camel(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  ctx.beginPath(); // 身体+双峰
  ctx.ellipse(x, y - s * 0.52, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - s * 0.18, y - s * 0.66, s * 0.13, 0, Math.PI * 2);
  ctx.arc(x + s * 0.18, y - s * 0.66, s * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + s * 0.38, y - s * 0.78, s * 0.1, s * 0.34);   // 颈
  ctx.beginPath();
  ctx.ellipse(x + s * 0.44, y - s * 0.82, s * 0.09, s * 0.14, 0.5, 0, Math.PI * 2);
  ctx.fill();                                                       // 头
  ctx.strokeStyle = c; ctx.lineWidth = s * 0.05;
  for (const [lx, bend] of [[-0.32, 1], [0.12, -1], [0.34, 1], [-0.12, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x + s * lx, y - s * 0.5);
    ctx.lineTo(x + s * (lx + 0.08 * bend), y);
    ctx.stroke();
  }
}

// 蒙古包
function yurt(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y);
  ctx.lineTo(x - s * 0.5, y - s * 0.42);
  ctx.quadraticCurveTo(x, y - s * 0.95, x + s * 0.5, y - s * 0.42);
  ctx.lineTo(x + s * 0.5, y);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(x - s * 0.12, y - s * 0.34, s * 0.24, s * 0.34); // 门
}

// 马
function horse(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.55, s * 0.5, s * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // 颈+头
  ctx.moveTo(x + s * 0.3, y - s * 0.68);
  ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.95, x + s * 0.5, y - s * 1.0);
  ctx.quadraticCurveTo(x + s * 0.65, y - s * 0.98, x + s * 0.66, y - s * 0.88);
  ctx.quadraticCurveTo(x + s * 0.52, y - s * 0.8, x + s * 0.42, y - s * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = c; ctx.lineWidth = s * 0.06;
  for (const lx of [-0.36, -0.16, 0.14, 0.34]) {
    ctx.beginPath();
    ctx.moveTo(x + s * lx, y - s * 0.5);
    ctx.lineTo(x + s * lx, y);
    ctx.stroke();
  }
}

// 长城敌楼 + 城墙
function wallTower(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  const w = s * 0.66, h = s * 0.85;
  ctx.fillRect(x - w / 2, y - h, w, h);        // 楼体
  for (let i = -2; i <= 2; i++) {              // 垛口
    ctx.fillRect(x + i * w / 5 - w / 18, y - h - s * 0.12, w / 9, s * 0.12);
  }
  ctx.fillRect(x - w * 1.7, y - h * 0.55, w * 0.85, h * 0.5);  // 左墙
  ctx.fillRect(x + w * 0.85, y - h * 0.55, w * 0.85, h * 0.5); // 右墙
  for (let i = 0; i < 3; i++) {                // 箭窗
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x - w * 0.28 + i * w * 0.28, y - h * 0.72, w * 0.14, h * 0.3);
    ctx.fillStyle = c;
  }
}

// 泰山石坊
function stoneGate(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  const w = s * 1.1;
  ctx.fillRect(x - w / 2, y - s * 0.85, s * 0.14, s * 0.85);
  ctx.fillRect(x + w / 2 - s * 0.14, y - s * 0.85, s * 0.14, s * 0.85);
  ctx.fillRect(x - w / 2 - s * 0.08, y - s * 1.0, w + s * 0.16, s * 0.16); // 梁
  ctx.fillRect(x - w / 2 - s * 0.15, y - s * 1.18, w + s * 0.3, s * 0.1);  // 顶
  ctx.fillRect(x - s * 0.05, y - s * 1.32, s * 0.1, s * 0.16);
}

// 故宫殿堂（重檐）
function palaceHall(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  const w = s * 1.6;
  ctx.fillRect(x - w / 2, y - s * 0.42, w, s * 0.42); // 台/墙
  // 下檐
  roof(ctx, x, y - s * 0.42, w, s * 0.4, c);
  ctx.fillRect(x - w * 0.32, y - s * 0.78, w * 0.64, s * 0.36);
  // 上檐
  roof(ctx, x, y - s * 0.78, w * 0.78, s * 0.34, c);
  ctx.fillRect(x - w * 0.14, y - s * 1.18, w * 0.28, s * 0.12);
}
function roof(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.08, y);
  ctx.quadraticCurveTo(x - w * 0.2, y - h * 0.9, x, y - h);
  ctx.quadraticCurveTo(x + w * 0.2, y - h * 0.9, x + w / 2 + w * 0.08, y);
  ctx.lineTo(x + w / 2, y + h * 0.12);
  ctx.lineTo(x - w / 2, y + h * 0.12);
  ctx.closePath(); ctx.fill();
}

// 布达拉宫（依山而建的阶梯建筑群）
function potala(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  const baseW = s * 2.4;
  // 山体
  ctx.beginPath();
  ctx.moveTo(x - baseW, y);
  ctx.quadraticCurveTo(x - baseW * 0.6, y - s * 0.9, x, y - s * 1.15);
  ctx.quadraticCurveTo(x + baseW * 0.6, y - s * 0.9, x + baseW, y);
  ctx.closePath(); ctx.fill();
  // 白宫梯段
  const steps = [[1.9, 0.5], [1.5, 0.75], [1.1, 1.0]];
  let by = y;
  for (const [sw, sh] of steps) {
    ctx.fillRect(x - baseW * sw / 2, by - s * sh * 0.8, baseW * sw, s * sh * 0.8);
    by -= s * sh * 0.8;
  }
  // 红宫
  ctx.fillRect(x - s * 0.42, by - s * 0.55, s * 0.84, s * 0.55);
  ctx.fillRect(x - s * 0.08, by - s * 0.85, s * 0.16, s * 0.85); // 金顶
}

// 经幡（青海湖）
function prayerFlags(ctx, x, y, s, c) {
  ctx.strokeStyle = c; ctx.lineWidth = s * 0.04;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 1.3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.3);
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 1.1, x + s * 0.95, y - s * 0.85);
  ctx.stroke();
  const cols = ['rgba(200,60,50,0.9)', 'rgba(230,200,70,0.9)', 'rgba(90,160,220,0.9)', 'rgba(240,240,240,0.9)'];
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const fx = x + s * 0.95 * t + s * 0.05;
    const fy = y - s * 1.3 + s * 0.45 * t * t + s * 0.05;
    ctx.fillStyle = cols[i % 4];
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + s * 0.14, fy + s * 0.03);
    ctx.lineTo(fx + s * 0.14, fy + s * 0.2); ctx.lineTo(fx, fy + s * 0.18);
    ctx.closePath(); ctx.fill();
  }
}

// 竹筏（漓江水面）
function bambooRaft(ctx, x, y, s, c) {
  ctx.strokeStyle = c; ctx.lineWidth = s * 0.045;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y + i * s * 0.06);
    ctx.lineTo(x + s * 0.5, y + i * s * 0.06);
    ctx.stroke();
  }
  ctx.beginPath(); // 撑篙人
  ctx.lineWidth = s * 0.05;
  ctx.moveTo(x - s * 0.2, y); ctx.lineTo(x - s * 0.2, y - s * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - s * 0.2, y - s * 0.34, s * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = c; ctx.fill();
}

// 飞鸟
function birds(ctx, x, y, s, c, t) {
  ctx.strokeStyle = c; ctx.lineWidth = s * 0.025;
  const flap = Math.sin(t * 6) * s * 0.03;
  for (let i = 0; i < 3; i++) {
    const bx = x + i * s * 0.22, by = y + (i % 2) * s * 0.08;
    ctx.beginPath();
    ctx.moveTo(bx - s * 0.08, by - flap);
    ctx.quadraticCurveTo(bx, by + s * 0.04, bx + s * 0.08, by - flap);
    ctx.stroke();
  }
}

/* ---------------- 十二景数据 ---------------- */

export const SCENES = [
  {
    id: 'xihu', name: '杭州西湖', ch: '湖', sub: '欲把西湖比西子，淡妆浓抹总相宜',
    photo: 'assets/photos/xihu.jpg',
    intro: '西湖三面环山、一面临城，"西湖十景"名扬天下。漫步苏堤，柳浪闻莺，远眺雷峰塔，尽是江南的温柔。',
    tips: ['苏堤由苏东坡主持疏浚时所筑', '雷峰塔与《白蛇传》的传说', '2011年列入世界文化遗产'],
    sky: ['#bfe4f2', '#eef9f6'], sun: { x: 0.78, y: 0.2, r: 0.05, c: '#ffdda8', type: 'sun' },
    far: '#a8c8d8', mid: '#8fb6cc', near: '#6f9dbd', ground: '#cfe0c0', path: '#e8dcc0',
    water: { top: 0.66, c: '#8ec8de' }, ridge: [{ a: 0.05, wl: 520 }, { a: 0.07, wl: 380 }],
    motif: { fn: pagoda, every: 5200, layer: 1, s: 120, args: [5] },
    extra: (ctx, x, y, s, c, t) => { bambooRaft(ctx, x + 200, y - 8, s * 0.9, c, t); },
    birds: true,
  },
  {
    id: 'huangshan', name: '黄山云海', ch: '黄', sub: '五岳归来不看山，黄山归来不看岳',
    photo: 'assets/photos/huangshan.jpg',
    intro: '黄山以奇松、怪石、云海、温泉"四绝"著称。雨后初晴，云雾在群峰间翻涌如浪，峰峦若隐若现，宛如仙境。',
    tips: ['迎客松是安徽的标志', '徐霞客：登黄山，天下无山', '1990年列入世界文化与自然遗产'],
    sky: ['#c9d6e8', '#f2ede4'], sun: { x: 0.2, y: 0.16, r: 0.045, c: '#fff2d0', type: 'sun' },
    far: '#b8c4d6', mid: '#93a2b8', near: '#6b7d96', ground: '#b7c4a8', path: '#d8d2bc',
    cloudsStrong: true, ridge: [{ a: 0.09, wl: 420 }, { a: 0.12, wl: 300 }],
    motif: { fn: pine, every: 4600, layer: 1, s: 130 },
    birds: true,
  },
  {
    id: 'lijiang', name: '桂林漓江', ch: '漓', sub: '江作青罗带，山如碧玉簪',
    photo: 'assets/photos/lijiang.jpg',
    intro: '漓江蜿蜒于喀斯特峰林之间，江水清澈如镜。"江作青罗带，山如碧玉簪"，乘竹筏漂流最是惬意。',
    tips: ['二十元人民币背面取景地', '世界自然遗产喀斯特地貌', '渔火与鸬鹚是漓江一景'],
    sky: ['#cfe8f0', '#f6f4e8'], sun: { x: 0.82, y: 0.22, r: 0.05, c: '#ffe8c0', type: 'sun' },
    far: '#a9c4c9', mid: '#86a89c', near: '#5f8a7c', ground: '#cfe0b8', path: '#e5dcc2',
    water: { top: 0.68, c: '#9fd4d4' }, ridge: [{ a: 0.10, wl: 300 }, { a: 0.13, wl: 220 }],
    motif: { fn: karst, every: 2600, layer: 1, s: 150 },
    extra: (ctx, x, y, s, c, t) => { bambooRaft(ctx, x, y - 10, s, c, t); },
    birds: true,
  },
  {
    id: 'zhangjiajie', name: '张家界', ch: '界', sub: '扩大的盆景，缩小的仙境',
    photo: 'assets/photos/zhangjiajie.jpg',
    intro: '三千奇峰拔地而起，宛如刀削斧劈的石柱森林。云雾缭绕时群峰似悬浮空中，电影《阿凡达》的"哈利路亚山"即取灵感于此。',
    tips: ['《阿凡达》悬浮山原型', '世界自然遗产武陵源', '拥有世界最长玻璃桥'],
    sky: ['#d4e2ee', '#f0f2ec'], sun: { x: 0.25, y: 0.18, r: 0.045, c: '#ffe8c8', type: 'sun' },
    far: '#a5b8cb', mid: '#7e97ad', near: '#567389', ground: '#b5c4a4', path: '#ddd6be',
    mist: true, ridge: [{ a: 0.07, wl: 480 }, { a: 0.09, wl: 340 }],
    motif: { fn: pillar, every: 2200, layer: 1, s: 160 },
  },
  {
    id: 'erhai', name: '大理洱海', ch: '洱', sub: '苍山不墨千秋画，洱海无弦万古琴',
    photo: 'assets/photos/erhai.jpg',
    intro: '洱海形如人耳，静卧于苍山脚下。湖光山色相映，白族渔村点缀其间，"风花雪月"中的"洱海月"最动人。',
    tips: ['崇圣寺三塔千年屹立', '白族扎染与三道茶', '环湖骑行胜地'],
    sky: ['#b8dff0', '#eaf6f0'], sun: { x: 0.7, y: 0.18, r: 0.05, c: '#ffdca8', type: 'sun' },
    far: '#a3c4cf', mid: '#7fa8b5', near: '#5b8a95', ground: '#d2e4c0', path: '#e8dcc0',
    water: { top: 0.66, c: '#79c1d8' }, ridge: [{ a: 0.10, wl: 560 }, { a: 0.12, wl: 400 }],
    motif: { fn: pagoda, every: 5600, layer: 1, s: 110, args: [3] },
    birds: true,
  },
  {
    id: 'dunhuang', name: '敦煌鸣沙山', ch: '煌', sub: '大漠孤烟直，长河落日圆',
    photo: 'assets/photos/dunhuang.jpg',
    intro: '鸣沙山沙峰起伏，风吹沙响；山下月牙泉形如弯月，千年不涸。驼铃声声，仿佛重回丝绸之路。',
    tips: ['丝绸之路重镇', '莫高窟壁画艺术宝库', '月牙泉千年不涸之谜'],
    sky: ['#f2c898', '#f9eed6'], sun: { x: 0.5, y: 0.3, r: 0.09, c: '#ff9d4d', type: 'sun' },
    far: '#e0b878', mid: '#c89a58', near: '#a87c3e', ground: '#d8b878', path: '#ecce8e',
    ridge: [{ a: 0.06, wl: 640 }, { a: 0.08, wl: 460 }],
    motif: { fn: camel, every: 3800, layer: 2, s: 100 },
  },
  {
    id: 'hulunbeir', name: '呼伦贝尔草原', ch: '原', sub: '天苍苍，野茫茫，风吹草低见牛羊',
    photo: 'assets/photos/hulunbeir.jpg',
    intro: '世界四大草原之一。蓝天白云下绿浪千里，牛羊如珠玑散落，蒙古包炊烟袅袅，正是"天苍苍，野茫茫"。',
    tips: ['世界四大草原之一', '那达慕大会与赛马摔跤', '额尔古纳湿地'],
    sky: ['#a8d4f0', '#e8f4d8'], sun: { x: 0.76, y: 0.2, r: 0.05, c: '#ffe0a8', type: 'sun' },
    far: '#9cc490', mid: '#7cb074', near: '#58964a', ground: '#8cbf6e', path: '#d8cba0',
    ridge: [{ a: 0.03, wl: 700 }, { a: 0.04, wl: 520 }],
    motif: { fn: yurt, every: 4200, layer: 2, s: 110 },
    extra: (ctx, x, y, s, c, t) => { horse(ctx, x + 260, y - 4, s * 0.85, c); },
    birds: true,
  },
  {
    id: 'greatwall', name: '万里长城', ch: '城', sub: '不到长城非好汉，屈指行程二万',
    photo: 'assets/photos/greatwall.jpg',
    intro: '长城横亘崇山峻岭，如巨龙盘踞。春秋战国始筑，明代重修，两千年间守护着农耕文明。',
    tips: ['世界文化遗产', '总长超过两万公里', '敌楼与烽火台的军事智慧'],
    sky: ['#d4e0ec', '#f4ecdc'], sun: { x: 0.22, y: 0.2, r: 0.05, c: '#ffd9a0', type: 'sun' },
    far: '#b0a898', mid: '#8c8474', near: '#645c4c', ground: '#c4b894', path: '#dcd2b4',
    ridge: [{ a: 0.09, wl: 460 }, { a: 0.11, wl: 320 }],
    motif: { fn: wallTower, every: 3400, layer: 1, s: 130 },
  },
  {
    id: 'taishan', name: '泰山日出', ch: '泰', sub: '会当凌绝顶，一览众山小',
    photo: 'assets/photos/taishan.jpg',
    intro: '五岳之首，历代帝王封禅之地。夜攀泰山观日出是无数人的心愿：云海翻腾处，红日跃出。',
    tips: ['五岳之首，帝王封禅', '旭日东升与云海玉盘', '十八盘千级石阶'],
    sky: ['#f4b888', '#fdeed0'], sun: { x: 0.5, y: 0.38, r: 0.11, c: '#ffb84d', type: 'sun', rise: true },
    far: '#c8a888', mid: '#a08064', near: '#78604a', ground: '#ccb494', path: '#e4d2ac',
    ridge: [{ a: 0.11, wl: 500 }, { a: 0.13, wl: 360 }],
    motif: { fn: stoneGate, every: 5000, layer: 1, s: 120 },
    birds: true,
  },
  {
    id: 'gugong', name: '故宫', ch: '宫', sub: '一朝步入画卷，一日梦回千年',
    photo: 'assets/photos/gugong.jpg',
    intro: '明清两代皇宫，世界现存规模最大的木结构宫殿群。红墙黄瓦，太和殿的飞檐在晨光中诉说六百年风云。',
    tips: ['太和殿俗称金銮殿', '世界五大宫殿之首', '1925年建为故宫博物院'],
    sky: ['#c8d8e8', '#f0e8e0'], sun: { x: 0.2, y: 0.16, r: 0.04, c: '#ffe8c8', type: 'sun' },
    far: '#b0a8a0', mid: '#907a70', near: '#6a5048', ground: '#c8b8a8', path: '#e8d8b8',
    ridge: [{ a: 0.04, wl: 800 }, { a: 0.05, wl: 600 }],
    motif: { fn: palaceHall, every: 5200, layer: 1, s: 140 },
  },
  {
    id: 'qinghaihu', name: '青海湖', ch: '青', sub: '碧波荡漾千里目，油菜花开遍地金',
    photo: 'assets/photos/qinghaihu.jpg',
    intro: '中国最大的内陆咸水湖，高原蓝宝石。七月环湖油菜花金黄铺展，湖畔经幡飘扬，水鸟翔集。',
    tips: ['中国最大咸水湖', '环湖油菜花海', '鸟岛候鸟栖息地'],
    sky: ['#a8d8f0', '#e8f4f8'], sun: { x: 0.78, y: 0.18, r: 0.05, c: '#ffe0a8', type: 'sun' },
    far: '#98c0d8', mid: '#74a8c8', near: '#5090b0', ground: '#e0c84e', path: '#e8dca0',
    water: { top: 0.64, c: '#68b8d8' }, ridge: [{ a: 0.05, wl: 620 }, { a: 0.06, wl: 440 }],
    motif: { fn: prayerFlags, every: 4400, layer: 2, s: 120 },
    birds: true,
  },
  {
    id: 'potala', name: '布达拉宫', ch: '藏', sub: '住进布达拉宫，我是雪域最大的王',
    photo: 'assets/photos/potala.jpg',
    intro: '布达拉宫依红山而建，海拔3700米，白宫红殿层叠而上，金顶映日，已守望拉萨千年。',
    tips: ['世界海拔最高的宫殿', '松赞干布始建', '1994年列入世界遗产'],
    sky: ['#c8e0f0', '#f0ead8'], sun: { x: 0.24, y: 0.18, r: 0.05, c: '#fff0c8', type: 'sun' },
    far: '#b0a8b8', mid: '#8880a0', near: '#605880', ground: '#c8b8a8', path: '#e0d4b0',
    ridge: [{ a: 0.12, wl: 540 }, { a: 0.14, wl: 380 }],
    motif: { fn: potala, every: 6000, layer: 1, s: 130 },
    birds: true,
  },
];

/** 整理放松阶段的康复小知识（每 20 秒轮换一条） */
export const HEALTH_TIPS = [
  '运动后不要立刻坐下或洗热水澡，先慢走几分钟，让心率平稳回落。',
  '运动后补水要小口多次，不要一次猛灌。',
  '"有点累但还能说话"就是合适的强度，感觉比数字更重要。',
  '规律运动每周 3~5 次，比偶尔一次练到累更有效。',
  '如出现胸闷、胸痛、明显气短，请立即停止并告知医生。',
  '运动前后各做 5 分钟热身和整理，能显著降低心血管风险。',
  '服用β受体阻滞剂时，请以疲劳感觉（RPE）为准，不要只看心率。',
  '有氧运动加坐站练习，康复效果会更好。',
];

/* ---------------- 实景照片 ---------------- */

/** 预加载全部景点照片（加载失败自动回退程序化场景） */
export function loadScenePhotos() {
  SCENES.forEach(s => {
    const img = new Image();
    img.onload = () => { s._photoImg = img; };
    img.onerror = () => { console.warn('[云游山河] 景点照片加载失败，使用程序化场景：', s.photo); };
    img.src = s.photo;
  });
}

/** 实景照片世界：Ken Burns 缓动 + 轻雾 + 地面道路 */
function drawPhotoWorld(ctx, W, H, scene, t, distKm, opts = {}) {
  const alpha = opts.alpha ?? 1;
  const img = scene._photoImg;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Ken Burns：缓慢呼吸缩放与平移，随时间产生"行进中的风景"感
  const seed = scene.id.length;
  const zoom = 1.07 + 0.05 * Math.sin(t * 0.04 + seed);
  const panX = Math.sin(t * 0.023 + seed * 2) * 0.014;
  const scale = Math.max(W / img.width, H / img.height) * zoom;
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2 + panX * W, (H - dh) / 2, dw, dh);
  // 轻雾飘动（行进反馈）
  const off = (distKm * PXKM * 0.5) % (W * 1.5);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 3; i++) {
    const y = H * (0.34 + i * 0.12);
    const x = ((i * W * 0.7 + off) % (W * 1.5)) - W * 0.25;
    ctx.beginPath();
    ctx.ellipse(x, y, W * (0.32 + (i % 2) * 0.18), H * 0.032, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 飞鸟
  if (scene.birds) {
    const bx = ((t * 22) % (W + 300)) - 150;
    birds(ctx, bx, H * 0.16, 110, 'rgba(40,50,60,0.45)', t);
  }
  // 底部道路（照片渐变过渡，人走在路上）
  const top = H * 0.8;
  const g = ctx.createLinearGradient(0, top - H * 0.1, 0, top + H * 0.04);
  g.addColorStop(0, 'rgba(52,64,46,0)');
  g.addColorStop(1, 'rgba(52,64,46,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, top - H * 0.1, W, H * 0.14);
  ctx.fillStyle = 'rgba(58,70,52,0.95)';
  ctx.fillRect(0, top + H * 0.04, W, H);
  ctx.fillStyle = 'rgba(236,224,196,0.92)';
  ctx.fillRect(0, top + (H - top) * 0.22, W, (H - top) * 0.5);
  const soff = (distKm * PXKM) % 260;
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = -1; i < W / 260 + 2; i++) {
    const x = i * 260 - soff;
    ctx.beginPath();
    ctx.ellipse(x + 40, top + (H - top) * 0.56, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 170, top + (H - top) * 0.4, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 顶部渐晕，保证 HUD 可读
  const vg = ctx.createLinearGradient(0, 0, 0, H * 0.16);
  vg.addColorStop(0, 'rgba(14,22,30,0.42)');
  vg.addColorStop(1, 'rgba(14,22,30,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H * 0.16);
  ctx.restore();
}

/* ---------------- 世界绘制 ---------------- */

/** 连绵山脊：以世界坐标为自变量的连续函数，保证无缝滚动 */
function ridgeY(worldX, scene, layerIdx) {
  const r = scene.ridge[layerIdx];
  return (
    Math.sin(worldX / r.wl) * 0.55 +
    Math.sin(worldX / (r.wl * 0.37) + layerIdx * 2.1) * 0.3 +
    Math.sin(worldX / (r.wl * 0.11) + layerIdx * 5.7) * 0.15
  ) * r.a;
}

function drawRidge(ctx, W, H, baseY, color, off, scene, li) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + 20; sx += 16) {
    const y = baseY + ridgeY(sx + off, scene, li) * H;
    ctx.lineTo(sx, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawClouds(ctx, W, H, t, strong, c = 'rgba(255,255,255,0.75)') {
  const n = strong ? 7 : 4;
  ctx.fillStyle = c;
  for (let i = 0; i < n; i++) {
    const speed = 8 + (i % 3) * 5;
    const x = ((i * 397 + t * speed) % (W + 300)) - 150;
    const y = H * (0.08 + ((i * 53) % 30) / 100);
    const s = 40 + (i % 4) * 22;
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(x + s * 0.55, y + s * 0.08, s * 0.6, s * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWater(ctx, W, H, scene, t, distKm) {
  const top = H * scene.water.top, bottom = H * 0.8;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, scene.water.c);
  g.addColorStop(1, mixColor(scene.water.c, '#ffffff', 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, bottom - top);
  // 波光
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  const off = (distKm * PXKM) % 90;
  for (let i = 0; i < 5; i++) {
    const y = top + 12 + i * (bottom - top - 20) / 5;
    for (let k = 0; k < 4; k++) {
      const x = ((k * 220 + i * 57 - off * 0.4 + Math.sin(t * 0.8 + i) * 18) % (W + 120)) - 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 22, y - 3, x + 44, y);
      ctx.stroke();
    }
  }
}

function drawGround(ctx, W, H, scene, distKm, mixNext) {
  const top = H * 0.8;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, mixColor(scene.ground, '#ffffff', 0.12));
  g.addColorStop(1, scene.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  // 走的道路（浅色带）
  ctx.fillStyle = scene.path;
  ctx.fillRect(0, top + (H - top) * 0.18, W, (H - top) * 0.52);
  // 滚动的小石子 / 草丛，体现行进
  const off = (distKm * PXKM) % 260;
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = -1; i < W / 260 + 2; i++) {
    const x = i * 260 - off;
    ctx.beginPath();
    ctx.ellipse(x + 40, top + (H - top) * 0.55, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 170, top + (H - top) * 0.42, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 绘制整个世界（一个景点）。
 * @param mixNext 下一景（场景过渡时 0~1 淡入），null 表示不过渡
 */
export function drawWorld(ctx, W, H, scene, t, distKm, opts = {}) {
  // 实景照片模式（照片加载成功时优先；失败自动回退程序化场景）
  if (scene._photoImg) {
    drawPhotoWorld(ctx, W, H, scene, t, distKm, opts);
    return;
  }
  const alpha = opts.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;

  // 天空
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.85);
  g.addColorStop(0, scene.sky[0]);
  g.addColorStop(1, scene.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const worldPx = distKm * PXKM;

  // 日 / 月
  const sun = scene.sun;
  const sx = W * sun.x, sy = H * sun.y - (sun.rise ? Math.sin(t * 0.05) * 6 : 0);
  const sr = W * sun.r;
  const halo = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 2.6);
  halo.addColorStop(0, sun.c);
  halo.addColorStop(0.35, mixColor(sun.c, '#ffffff', 0.35));
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(sx - sr * 2.6, sy - sr * 2.6, sr * 5.2, sr * 5.2);
  ctx.fillStyle = sun.c;
  ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();

  // 云
  drawClouds(ctx, W, H, t, !!scene.cloudsStrong);

  // 远山 + 中山（视差）
  drawRidge(ctx, W, H, H * 0.52, scene.far, worldPx * 0.22, scene, 0);
  // 远景剪影
  if (scene.motif.layer === 0) drawMotifs(ctx, W, H, scene, worldPx * 0.22, scene.far, 0.52);
  drawRidge(ctx, W, H, H * 0.62, scene.mid, worldPx * 0.45, scene, 1);
  // 中景剪影（大部分景点的主剪影在这层）
  if (scene.motif.layer === 1) drawMotifs(ctx, W, H, scene, worldPx * 0.45, scene.mid, 0.62);

  // 水面
  if (scene.water) drawWater(ctx, W, H, scene, t, distKm);

  // 地面
  drawGround(ctx, W, H, scene, distKm);

  // 前景层剪影（草原蒙古包/驼队等贴地的）
  if (scene.motif.layer === 2) drawMotifs(ctx, W, H, scene, worldPx * 0.8, scene.near, 0.8);
  if (scene.extra) {
    const spacing = scene.motif.every * 1.4;
    const off = worldPx * 0.8;
    const first = Math.floor(off / spacing) * spacing;
    for (let wx = first; wx < off + W + 400; wx += spacing) {
      scene.extra(ctx, wx - off, H * 0.8, scene.motif.s, scene.near, t);
    }
  }

  // 飞鸟
  if (scene.birds) {
    const bx = ((t * 22) % (W + 300)) - 150;
    birds(ctx, bx, H * 0.18, 110, 'rgba(60,70,80,0.5)', t);
  }

  ctx.restore();
}

/** 沿世界坐标等间距摆放景点剪影 */
function drawMotifs(ctx, W, H, scene, off, color, groundFrac) {
  const m = scene.motif;
  const first = Math.floor(off / m.every) * m.every;
  ctx.fillStyle = color;
  for (let wx = first; wx < off + W + m.s * 2; wx += m.every) {
    const x = wx - off;
    const s = m.s * (0.85 + 0.3 * Math.abs(Math.sin(wx * 0.7)));
    m.fn(ctx, x, H * groundFrac, s, color, ...(m.args || []));
  }
}
