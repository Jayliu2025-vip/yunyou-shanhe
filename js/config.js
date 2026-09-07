/**
 * 云游山河 · 心脏康复集章之旅 —— 全局配置
 *
 * 本文件集中存放【医学相关参数】与【游戏参数】，方便课题研究人员调整：
 *  - 医学参数（medical）：运动强度处方、RPE 目标区间、心率安全阈值逻辑
 *  - 课程结构（session）：热身 / 主运动 / 整理放松时长
 *  - 步频节奏（tempo）：踏步频率目标与自适应调整幅度
 *  - 游戏参数（game）：里程折算、集章规则、捕捉判定
 *
 * 修改后刷新页面即可生效（无需重新编译）。
 */

export const CONFIG = {
  medical: {
    // 最大心率公式：Tanaka（208 - 0.7 × 年龄），对中老年人比 220-年龄 更准确
    maxHrFormula: 'tanaka',

    // Karvonen 储备心率法：目标心率 = 静息心率 + 强度% ×（最大心率 - 静息心率）
    // 冠心病 II/III 期康复常规处方：40%~60% 储备心率（中等强度）
    intensityLow: 0.40,
    intensityHigh: 0.60,

    // 自觉疲劳量表：采用 CR10（0~10），便于中老年患者理解
    // 目标区间 3~4 ≈ Borg 6-20 量表的 11~13（"有点累～稍累"，还能说话不能唱歌）
    rpeScale: 'CR10',
    rpeTargetLow: 3,
    rpeTargetHigh: 4,

    // 主运动阶段每 5 分钟弹出一次 RPE 自评
    rpePromptIntervalSec: 300,

    // 心率持续超上限 12 秒 → 自动暂停进入休息界面
    hrOverLimitPauseSec: 12,

    // 院内监护模式（II期，有医护在场观察）：强度上限更保守、超限响应更快、RPE 询问更频繁
    clinic: { intensityHigh: 0.50, hrOverLimitPauseSec: 8, rpePromptIntervalSec: 180 },

    // 服用 β 受体阻滞剂 / 植入起搏器时，心率法失真 → 以 RPE 为主，心率仅参考
    betaBlockerNote: '您选择了服用β受体阻滞剂/起搏器，本次以自觉疲劳（RPE）为主控指标，心率仅供参考。',

    // 无心率设备模式（2026-09 依据 2026 ESC 心脏康复指南"居家/远程康复为有效替代"、
    // 《中国心血管疾病患者居家康复专家共识》低强度 40%~60% HRR ≈ Borg 11~13、
    // CSANZ 2023"无监护运动以 RPE+说话测试+症状自监"确定）：
    // 不连接心率带/研究设备时，RPE 询问间隔由 300s 收紧到 180s，说话测试文案随弹窗提示
    noDevice: {
      rpePromptIntervalSec: 180,
    },

    // 说话测试（talk test）：无监护模式下的强度自检口诀，随 RPE 弹窗显示
    talkTestNote: '说话测试：能连贯说话但唱不了歌 = 强度合适；喘得说不出整句 = 过大，请放慢。',
  },

  session: {
    // 标准课程结构（秒）：热身 5 分钟 → 主运动 20 分钟 → 整理 4 分钟
    warmupSec: 300,
    mainSec: 1200,
    cooldownSec: 240,
    mainSecChoices: [
      { sec: 900, label: '15 分钟' },
      { sec: 1200, label: '20 分钟（推荐）' },
      { sec: 1800, label: '30 分钟' },
    ],
    // 快速体验模式（演示/调试用）
    quickTest: { warmupSec: 20, mainSec: 90, cooldownSec: 20 },
  },

  tempo: {
    warmup: 92,          // 热身目标步频（步/分钟）
    cooldown: 80,        // 整理阶段目标步频
    start: 104,          // 主运动起始目标步频
    min: 84,             // 自适应下限
    max: 124,            // 自适应上限
    rpeHighAdjust: -8,   // RPE 超标时步频下调幅度
    rpeLowAdjust: 5,     // RPE 偏低时步频上调幅度
  },

  game: {
    stepsPerKm: 1350,        // 原地踏步折算：约 1350 步 ≈ 1 公里
    stampCardNeed: 12,       // 每个景点需要集齐的印章数
    stampEverySec: 36,       // 印章平均出现间隔（主运动阶段）
    bonusEverySec: 9,        // 加分小物件平均出现间隔
    itemRadius: 0.085,       // 捕捉半径（占画面宽度的比例，取得偏大方便中老年玩家）
    itemLifeSec: 8,          // 物件停留时长
    syncBonusSec: 18,        // 踩准节拍持续 N 秒 → 奖励一枚金印
    syncTolerance: 9,        // 步频与目标误差 ±9 步/分 内算"合拍"
    kcalPerStepPerKg: 0.00064, // 能量消耗粗估（kcal/步/公斤；原 0.045 kcal/步 ≈ 70kg 人群，v1.3.1 起按档案体重折算）
  },

  // 站内风景轮换（v1.3.4：同一景点内每 N 秒在本站的多张实拍图之间 2 秒缓变淡切，
  // 避免长驻一站时背景长时间静止；只在本站图集内轮换、绝不跨地区——
  // 防止"杭州站看到别处风景"的语义混淆（跨景点"远眺巡游"已移除）；0 = 关闭）
  scene: {
    photoRotateSec: 15,
    photoFadeSec: 2.0,
  },

  // 力量小站（v1.3）：主运动中的间歇坐站练习，设置页勾选后由 plan.strengthBlocks 开启。
  // 依据：《中国人群身体活动指南（2021）》65岁+每周至少3天大肌群力量与健骨练习；
  // WHO《身体活动与久坐行为指南（2020）》老年人多成分活动强调功能性力量（≥3天/周）；
  // 《World guidelines for falls prevention and management for older adults》
  // （Montero-Odasso 2022, Age and Ageing 51(9)）——渐进抗阻力量训练为运动干预核心成分；
  // Otago 运动方案：坐站起始 4次×2组、进阶至10次×2组，慢速、可扶椅；
  // 《中国心血管疾病患者居家康复专家共识（2022）》：抗阻训练低~中强度、不憋气（无 Valsalva）。
  exercise: {
    firstBlockAfterSec: 90,  // 主运动开始 90 秒后进行第一个小站（先让有氧进入稳态）
    blockEverySec: 240,      // 之后每 4 分钟一个小站（20 分钟主运动约 4~5 个）
    blockDurSec: 75,         // 每小站 75 秒 ≈ Otago 一组慢速坐站（约 10~15 次）
    blockTempo: 15,          // 小站节拍：每分钟起坐周期（约 4 秒一次，慢起慢坐）
    repsPerStamp: 3,         // 每完成 3 次起坐发一枚印章（总量被时长×慢节拍封顶，不奖励快和猛）
    announceSec: 5,          // 小站预告时长（语音 + 大字提示，留出走到椅子的时间）
    rpeSkipAt: 5,            // RPE ≥5 自动跳过下一个小站（≥6 仍走 rpe-hard 休息流程）
    sitStand: {
      standKneeAngle: 160,   // 膝角（髋-膝-踝）≥160° 判定站直
      sitKneeAngle: 110,     // 膝角 ≤110° 判定坐稳（两阈间为滞回区，抗抖动）
      minRepIntervalMs: 2000,// 两次起坐最小间隔（防抖，与 blockTempo=15 呼应）
      // 踝部不可见（镜头偏近）时的退化判定：站立时髋明显高于膝，坐位时接近
      hipKneeRatioStand: 0.40, // (膝y-髋y)/躯干 ≥ 此值 → 站立
      hipKneeRatioSit: 0.25,   // (膝y-髋y)/躯干 ≤ 此值 → 坐稳
    },
    // 注：检测系数基于 MediaPipe Pose（lite）归一化坐标设定，尚待大样本校准（同 CLAUDE.md 已知事项）；
    // 如需按患者情况调整，只改此处，勿在 game.js/pose.js 内散落魔法数。
  },
};

/** 根据年龄与静息心率计算目标心率区间（Karvonen） */
export function targetHrZone(age, restingHr, cfg = CONFIG.medical) {
  const maxHr = 208 - 0.7 * age;
  const reserve = Math.max(30, maxHr - restingHr);
  return {
    maxHr: Math.round(maxHr),
    low: Math.round(restingHr + cfg.intensityLow * reserve),
    high: Math.round(restingHr + cfg.intensityHigh * reserve),
  };
}
