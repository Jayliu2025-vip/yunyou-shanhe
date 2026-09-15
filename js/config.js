/** Game visuals and demo-only options. Clinical execution uses a verified rehab-plan. */
export const CONFIG = {
  session: {
    // 标准课程结构（秒）：热身 5 分钟 → 主运动 20 分钟 → 整理 4 分钟
    warmupSec: 300,
    mainSec: 1200,
    cooldownSec: 240,
    mainSecChoices: [
      { sec: 900, label: '15 分钟' },
      { sec: 1200, label: '20 分钟演示' },
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

  // 坐站识别及小站仅供合成演示；参数需真机及临床标定。
  exercise: {
    firstBlockAfterSec: 90,  // 主运动开始 90 秒后进行第一个小站（先让有氧进入稳态）
    blockEverySec: 240,      // 之后每 4 分钟一个小站（20 分钟主运动约 4~5 个）
    blockDurSec: 75,         // 演示小站时长（不构成运动处方）
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
