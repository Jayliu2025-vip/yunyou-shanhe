/**
 * 本地数据存储：用户档案、训练记录、旅程进度、设置
 * 全部存于 localStorage，可导出 CSV / JSON 供科研分析。
 */

const KEYS = {
  profile: 'yysn_profile',
  sessions: 'yysn_sessions',
  journey: 'yysn_journey',
  settings: 'yysn_settings',
};

function loadJSON(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch (e) {
    return def;
  }
}
function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn('存储失败', e);
  }
}

/* ---------------- 用户档案 ---------------- */

export function getProfile() {
  return loadJSON(KEYS.profile, {
    name: '',
    age: 55,
    restingHr: 70,
    betaBlocker: false,      // 服用β受体阻滞剂 / 植入起搏器
    mode: 'standing',        // standing | seated
    mainSec: 1200,
  });
}
export function saveProfile(p) { saveJSON(KEYS.profile, p); }

/* ---------------- 设置 ---------------- */

export function getSettings() {
  return loadJSON(KEYS.settings, {
    sound: true,             // 音效
    speech: true,            // 语音教练
    autoWalkDemo: false,     // 演示模式自动踏步
  });
}
export function saveSettings(s) { saveJSON(KEYS.settings, s); }

/* ---------------- 旅程（集章进度） ---------------- */

export function getJourney() {
  return loadJSON(KEYS.journey, {
    totalKm: 0,              // 累计里程（公里）
    sceneIndex: 0,           // 当前景点下标（0~11，循环）
    stampsInScene: 0,        // 当前景点已集印章数
    stampsTotal: 0,          // 累计印章数
    rounds: 0,               // 完整环游中国圈数
  });
}
export function saveJourney(j) { saveJSON(KEYS.journey, j); }

/* ---------------- 训练记录 ---------------- */

export function getSessions() { return loadJSON(KEYS.sessions, []); }

/** 追加一条训练记录，返回更新后的数组 */
export function addSession(session) {
  const arr = getSessions();
  arr.push(session);
  saveJSON(KEYS.sessions, arr);
  return arr;
}

/** 本地日期字符串 YYYY-MM-DD */
function dateKey(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

/** 连续打卡天数（今天有记录则计入；否则从昨天往前数，保持"未断"状态） */
export function streakInfo() {
  const sessions = getSessions();
  if (!sessions.length) return { current: 0, best: 0, totalDays: 0, totalSessions: 0 };
  const daySet = new Set(sessions.map(s => dateKey(new Date(s.date))));
  const days = [...daySet].sort();           // 升序
  // best 连续
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]), cur = new Date(days[i]);
    const diff = Math.round((cur - prev) / 86400000);
    run = diff === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  // current 连续：从今天（或昨天）往回数
  const today = dateKey(new Date());
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  let anchor = daySet.has(today) ? today : (daySet.has(yesterday) ? yesterday : null);
  let current = 0;
  if (anchor) {
    let d = new Date(anchor);
    while (daySet.has(dateKey(d))) { current++; d.setDate(d.getDate() - 1); }
  }
  return { current, best, totalDays: days.length, totalSessions: sessions.length };
}

/** 上次训练日期（用于主页展示） */
export function lastSessionDate() {
  const arr = getSessions();
  if (!arr.length) return null;
  return arr[arr.length - 1].date;
}

/* ---------------- 导出 ---------------- */

export function exportCSV() {
  const arr = getSessions();
  const cols = [
    '日期', '结束方式', '场景', '监护方式', '姿势', '总时长秒', '热身秒', '主运动秒', '整理秒',
    '步数', '里程公里', '平均步频', '最高步频', '印章数', '物件数',
    '估算千卡', 'RPE记录', '心率均值', '心率峰值', '心率样本数',
    '自动暂停次数', '景点',
  ];
  const MON_LABEL = { hr: '心率设备', manual: '手动脉搏', rpe: '无设备(RPE主控)' };
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = arr.map(s => [
    s.date, s.endedBy, s.setting === 'clinic' ? '院内监护' : '居家',
    MON_LABEL[s.monitor] || '未记录', s.mode,
    s.durationSec.total, s.durationSec.warmup, s.durationSec.main, s.durationSec.cooldown,
    s.steps, s.distanceKm.toFixed(2), s.avgCadence, s.maxCadence, s.stampsEarned, s.itemsCaught,
    s.kcal.toFixed(1),
    (s.rpeSamples || []).map(r => `${Math.round(r.t / 60)}分:${r.v}`).join(' '),
    s.hrAvg ?? '', s.hrMax ?? '', (s.hrSeries || []).length,
    s.autoPauses ?? 0, (s.sceneNames || []).join('→'),
  ].map(esc).join(','));
  return '\uFEFF' + cols.join(',') + '\n' + rows.join('\n'); // BOM 方便 Excel 中文
}

export function exportJSON() {
  return JSON.stringify({
    profile: getProfile(),
    journey: getJourney(),
    sessions: getSessions(),
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function resetAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}

/* ---------------- 徽章（由数据推导，无需单独存储） ---------------- */

export function badges() {
  const j = getJourney();
  const st = streakInfo();
  const list = [
    { id: 'first', icon: '🏮', name: '迈出第一步', desc: '完成第一次训练', got: j.stampsTotal > 0 || st.totalSessions > 0 },
    { id: 'd3', icon: '🌱', name: '三日之约', desc: '连续打卡 3 天', got: st.best >= 3 },
    { id: 'd7', icon: '🎋', name: '七日同行', desc: '连续打卡 7 天', got: st.best >= 7 },
    { id: 'd21', icon: '🌳', name: '廿一日养成', desc: '连续打卡 21 天', got: st.best >= 21 },
    { id: 'd30', icon: '🏔️', name: '月度坚持', desc: '连续打卡 30 天', got: st.best >= 30 },
    { id: 'km10', icon: '🧭', name: '十里春风', desc: '累计行走 10 公里', got: j.totalKm >= 10 },
    { id: 'km50', icon: '🐎', name: '日行千里', desc: '累计行走 50 公里', got: j.totalKm >= 50 },
    { id: 's30', icon: '📖', name: '文牒渐满', desc: '累计集章 30 枚', got: j.stampsTotal >= 30 },
    { id: 's144', icon: '🎖️', name: '环游山河', desc: '集齐十二景 144 枚印章（环游一圈）', got: j.rounds >= 1 },
  ];
  return list;
}
