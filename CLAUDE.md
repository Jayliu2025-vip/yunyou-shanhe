# CLAUDE.md — 云游山河 项目记忆

冠心病 II/III 期康复体感游戏「云游山河」H5 原型：摄像头（MediaPipe，本地 vendor/）姿态识别，
原地踏步 + 抬手摘印集章，可选力量小站（间歇坐站）。纯静态站点，无构建步骤。
PWA：manifest.json + sw.js（页面网络优先、静态资源缓存优先+后台更新；**改前端代码后需 bump
sw.js 的 VERSION 否则手机二次打开可能用旧缓存**；vendor/wasm 约19MB 不预缓存、按需入缓存）。

## 项目目标（2026-09-05 用户确定，方向性决策）
1. **手机端优先**：主力设备是手机，UI/性能/交互一律手机优先，桌面为次
2. **后续接入微信小程序**：迁移路径见 README 第七节（web-view 嵌 H5 最省事 vs
   wx.createVKSession 原生迁移；注意 web-view 需企业主体+业务域名备案）
3. **可能不接心率检测设备**（指 BLE 心率带/研究手环；摄像头姿态识别是核心玩法，保留）：
   只做最基础最安全的运动，安全主控从"心率自动暂停"转向 RPE + 症状 + 说话测试
   ——即把现有 β阻滞剂安全模式推广为无设备默认路径；改动前与用户确认是否最终定案
4. **安全性以最新权威指南为依据**（用于伦理材料/论文/答辩，2026-09-05 复核更新）：
   - **《2026 ESC 心脏康复指南》**（Bäck M, Wilhelm M, Hansen D, 等. Eur Heart J 2026;
     doi:10.1093/eurheartj/ehag099，2026-08-28 ESC 年会发布，**ESC 首部心脏康复专门指南**）：
     居家康复/远程康复（CTR）/混合模式为"有效替代"（按临床风险+患者偏好选择交付方式）；
     智能手机 App、可穿戴等数字工具有助改善结局；适应证扩展（ACS/CCS/HF 含 HFpEF、
     SAVR/TAVI 术后、ACHD、AF、肿瘤心脏病）；衰弱与合并症不是拒绝康复的理由。
     ⚠️ 精确强度处方数字（%HRR/RPE 区间）在付费全文，论文引用前以原文为准
   - **《中国心血管疾病患者居家康复专家共识》(2022)**：国内居家康复最新综合共识（检索确认暂无
     更新版）。低强度 40%~60% HRR ≈ Borg RPE 11~13，每周 3~7 次 —— 与本项目 Karvonen
     40%~60% + CR10 目标 3~4 口径一致
   - 《经皮冠状动脉介入治疗患者术后长期管理中国专家共识》（中国循环杂志 2026;41(1):1-21，
     中国康复医学会心脏介入治疗与康复专业委员会参与）
   - 《老年慢性心力衰竭全周期康复专家共识》（康复学报 2025;35(2)）
   - Li et al. 2025 Lancet Digital Health：mHealth 居家康复 meta 分析（6MWD +24.7m vs 常规护理）
   - Stefanakis 2022 系统综述（Eur J Prev Cardiol）：居家康复严重不良事件 ≈1/23,823 患者·时、
     无运动相关死亡 —— 2025-2026 无更新的安全性专项 meta 分析，仍为基准证据
   - AHA《Core Components of Cardiac Rehabilitation Programs: 2024 Update》(Circulation)；
     2023 AHA/ACC 慢性冠心病指南（美国现行）
   - CSANZ 临床指南 (Verdicchio 2023)：无监护运动应自监 RPE + talk test + 症状
   - ESC/EAPC 运动强度处方传统：中等强度耐力训练 = Borg 6-20 量表 10~14（2026 ESC 指南沿用）
   - **力量小站依据（v1.3 增补）**：《中国人群身体活动指南（2021）》65岁+每周 ≥3 天大肌群
     力量与健骨练习、坚持平衡柔韧练习（推荐太极拳/八段锦）；WHO《身体活动与久坐行为指南
     (2020)》老年人多成分活动强调功能性力量（≥3天/周）；《World guidelines for falls
     prevention and management for older adults》（Montero-Odasso 2022, Age and Ageing
     51(9), worldfallsguidelines.org）——运动为跌倒预防首选干预，核心成分含渐进抗阻力量
     训练，推荐纳入太极（1A）；Otago 运动方案：坐站 4次×2组起步、慢速、可扶椅

## 运行 / 测试
- `node server.js --port 8616`（项目自带零依赖服务器；`npm run dev` 同）或 `python -m http.server 8616`
- URL 加 `?quick=1` = 快速模式（热身20s/主运动90s/整理20s），调试与演示用
- `node tests/test_sitstand.mjs` = 坐站检测 + 场景/配置完整性单元测试（18 项，无需浏览器）
- 演示模式：无需摄像头，←→ 键踏步、↑ 键起坐、鼠标当手；勾"自动行走"全自动播放（含自动起坐）；手机演示有踏步按钮
- 浏览器实测用 browser-use 技能；Playwright locator click 偶发失效时，用 evaluate 直调
  `document.getElementById(id).click()` 更可靠
- 页面不可见时 rAF 暂停 → 训练计时暂停（安全特性，勿改）

## 架构关键
- `js/config.js` = 医学参数唯一入口（含 clinic 院内模式覆盖、noDevice 无设备模式、
  scene.tourSec 背景巡游间隔、exercise 力量小站参数）；main.js `applyCfgOverrides()` 从 localStorage(settings.cfg) 运行时覆盖
- 会话数据 localStorage（yysn_profile / yysn_sessions / yysn_journey / yysn_settings）；
  CSV/JSON 导出在 storage.js（CSV 含"监护方式"列）
- 心率三通道 hr.js：BLE 0x180D / WebSocket 研究设备（津发，JSON 字段 bpm|hr|heart_rate）/ 手动输入
- audio.js：WebAudio 合成音效 + **CC0 素材音效**（assets/audio/*.mp3，Kenney Interface Sounds，
  许可见 assets/audio/CREDITS.md；_sfx() 变调播放，素材缺失回退合成）；语音教练支持
  **男/女声选择**（settings.voiceURI/voiceMode，listZhVoices() 按名字猜性别，设置页下拉+试听）
- scenes.js：实景照片**按需加载**（preloadScenePhotosAround 预取当前+下一站、ensureScenePhoto
  单张导出供巡游用；缺图自动回退程序化水墨场景）；HEALTH_TIPS 整理阶段轮播（13 条）；
  SCENES 含 intro/tips 文案
- game.js **背景"远眺"巡游**：每 scene.tourSec(15s) 从已加载照片中缓变淡切（2s，不闪眼），
  横幅标"当前站 · 远眺X"；物件/印章/HUD 仍是当前站语义；暂停时巡游停
- pose.js 踏步检测：踝-髋垂直距离/躯干长度归一化 + 站立基线自适应（**按时间衰减**）+ 滞回；
  腿部出镜失败自动切摆臂计数；演示模式 tapStep()；移动端摄像头 480×360
- pose.js 坐站检测（v1.3）：膝角（髋-膝-踝中点）滞回（站≥160°/坐≤110°，config.exercise.sitStand），
  起身沿计 1 次 + 2s 最小间隔防抖；踝不可见退化为髋-膝垂直高度比；膝不可见仅置 unavailable
  （BodyState.sitStand{reps,ok}）；game.js 用差值取数（sitStandBase），兼容 BodyInput 跨局复用
- game.js **力量小站（v1.3，默认关闭）**：plan.strengthBlocks 开启；主运动中每 4 分钟插入
  75s 坐站小站（预告5s→active75s→收尾语音）；节拍器在 active 期切换为 blockTempo=15 次/分
  （不修改 this.tempo，用 _effTempo()）；印章改 rep 驱动（每 3 次一枚）、合拍奖励暂停、
  里程暂停、低步频提醒暂停；RPE≥5 置 blockSkip 跳过下一站；HUD block chip + 跳过按钮；
  武当山站主题包装"太极桩功"；快速模式（?quick=1）首个小站压缩为热身结束即开
- 每次训练 new Game()（main.js startSession），结束写回 journey/sessions；
  session 含 monitor（监护方式）与 scenesCompleted（集齐整站次数）
- `miniprogram/`：微信小程序 web-view 壳（appid 占位，H5_URL 待部署后替换；接入步骤见 README 第七节）
- 微信内打开引导层（#wechat-overlay）：UA 含 MicroMessenger 或 `?wechat=1` 触发，
  "先体验"→准备页预勾演示+自动行走；sessionStorage 记忆已关闭（每次会话只提示一次）

## 趣味反馈约定（安全红线：游戏激励不得诱导强度冲高）
- 连击音阶/末印/里程碑/合拍亮音/称号/背景巡游——**只奖励手眼协调、踩准节拍、出勤坚持**，
  只丰富视听体验；背景巡游为 2 秒缓变淡切（不做快速闪切，防视觉刺激）
- 摘取动作不设时间压力惩罚（物件 8s 过期无扣分）；RPE 降速时游戏表现不掉（无惩罚机制）
- 语音有节流：speak() 同文 6s；连击夸赞 30s；里程碑本身间隔 ≥500 步
- 音效素材 CC0（Kenney），合成音兜底；音效总音量与节拍器一致，无突兀大声（心脏患者适用）

## 医学行为约定（改动需谨慎，论文口径与此一致）
- 目标心率 Karvonen（Tanaka maxHR=208-0.7×年龄）40%~60% HRR
- 院内 clinic 模式：强度上限 50%、心率超限 8s 自动暂停、RPE 间隔 180s；居家：60%、12s、300s
- **无设备安全模式（v1.2，2026 ESC 指南背书）**：开始训练时无实时心率（BLE/WS 未连且无手动
  脉搏）→ monitor='rpe'，RPE 间隔收紧至 180s（CONFIG.medical.noDevice）+ 说话测试弹窗与
  开场口诀；手动脉搏 → monitor='manual'，同样 RPE 主控；只有 monitor='hr'（connected 且
  非手动）才启用心率自动暂停；session.monitor 与 CSV"监护方式"列记录分组
- β受体阻滞剂：**不做心率自动暂停**（HUD 变色 + events 记录 beta-hr-high），RPE 主控强度
- RPE(CR10)：≥6 直接进休息界面（保守处置）；≥5 步频-8 且跳过下一个小站（若开启）；≤2 步频+5；目标区间 3~4
- 心率自动暂停 ≥3 次 → 休息界面提示"建议结束训练"
- 三段式课程：热身5min → 主运动15/20/30min → 整理4min（呼吸圆+康复小知识）

## Review 修复记录（2026-09-05 首次系统 review）
- [P0] 竖屏旋转引导层锁死游戏（CSS !important 压过 .hidden 且无关闭按钮）→ 改 JS 控制显隐 + 加"就按竖屏继续"
- [P0] 游戏内摄像头预览从不绘制 → game._loop 调 body.drawPreview()
- [P1] 心率 BLE/WS 断连后残留旧 bpm 继续驱动自动暂停 → disconnect 时 bpm=null
- [P1] β阻滞剂"不自动暂停"文档承诺与实现不符 → 实现之
- [P1] RPE≥6 仅降速偏激进 → 改为进呼吸休息界面
- [P2] 踏步基线衰减按帧不按时间（帧率相关）→ 按 dt 衰减
- [P2] 死代码 hr.onUpdate 移除；syncSoundBtn 在设置页同步；移动端摄像头降为 480×360
- [P3] 心率自动暂停≥3次增加"建议结束"提示

## Backlog（未做）
- 【小程序】确认企业主体资质；web-view 内摄像头（getUserMedia）iOS/安卓**真机实测**——
  不可用则演示模式降级或走 VKSession 原生迁移
- 【手机优先】中低端安卓机 MediaPipe CPU 降级推理真机实测（帧率/发热/耗电）
- 【无设备模式】步频默认值下调评估（104 是否偏高，待真人实测）；
  若课题论文按心率监控设计，砍设备属方案变更——定案前需导师/伦理确认
- 多患者档案切换（当前一设备一患者假设，共用平板会串数据）
- 真人踏步检测阈值标定（pose.js lift=-0.24 / plant=-0.09 系数未经大样本验证）
- 坐站检测阈值标定（config.exercise.sitStand 膝角/高度比系数基于归一化坐标设定，
  需真人实测校准；椅子高度/体型差异的影响待评估）

## 手机端优化记录（v1.2）
- 实景照片懒加载（首屏 2 张 ≈400KB，原全量 12 张 2.3MB）+ 批量压缩 q7
  （总 2.3MB→1.6MB，SSIM≥0.98，原图在 git 历史可回退）
- 微信内打开引导层 + 演示模式一键体验
- miniprogram/ web-view 壳（README 第七节四步接入）

## 图片版权
assets/photos 13 张全部来自 Unsplash/Pixabay/Pexels（许可宽松、无需署名，2026-09-06 完成
全部整改与登记，v1.2.1 曾替换 4 张来源不明图片）；逐图清单见 assets/photos/CREDITS.md

## Git
- 远程：github.com/Jayliu2025-vip/yunyou-shanhe（私有，main 分支）
