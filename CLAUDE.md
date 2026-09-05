# CLAUDE.md — 云游山河 项目记忆

冠心病 II/III 期康复体感游戏「云游山河」H5 原型：摄像头（MediaPipe，本地 vendor/）姿态识别，
原地踏步 + 抬手摘印集章。纯静态站点，无构建步骤。

## 运行 / 测试
- `node server.js --port 8616`（项目自带零依赖服务器；`npm run dev` 同）或 `python -m http.server 8616`
- URL 加 `?quick=1` = 快速模式（热身20s/主运动90s/整理20s），调试与演示用
- 演示模式：无需摄像头，←→ 键踏步、鼠标当手；勾"自动行走"全自动播放；手机演示有踏步按钮
- 浏览器实测用 browser-use 技能；Playwright locator click 偶发失效时，用 evaluate 直调
  `document.getElementById(id).click()` 更可靠
- 页面不可见时 rAF 暂停 → 训练计时暂停（安全特性，勿改）

## 架构关键
- `js/config.js` = 医学参数唯一入口（含 clinic 院内模式覆盖）；main.js `applyCfgOverrides()`
  从 localStorage(settings.cfg) 运行时覆盖
- 会话数据 localStorage（yysn_profile / yysn_sessions / yysn_journey / yysn_settings）；
  CSV/JSON 导出在 storage.js
- 心率三通道 hr.js：BLE 0x180D / WebSocket 研究设备（津发，JSON 字段 bpm|hr|heart_rate）/ 手动输入
- scenes.js：实景照片优先（assets/photos/*.jpg，缺图自动回退程序化水墨场景）；
  HEALTH_TIPS 整理阶段轮播；SCENES 含 intro/tips 文案
- pose.js 踏步检测：踝-髋垂直距离/躯干长度归一化 + 站立基线自适应（**按时间衰减**）+ 滞回；
  腿部出镜失败自动切摆臂计数；演示模式 tapStep()
- 每次训练 new Game()（main.js startSession），结束写回 journey/sessions

## 医学行为约定（改动需谨慎，论文口径与此一致）
- 目标心率 Karvonen（Tanaka maxHR=208-0.7×年龄）40%~60% HRR
- 院内 clinic 模式：强度上限 50%、心率超限 8s 自动暂停、RPE 间隔 180s；居家：60%、12s、300s
- β受体阻滞剂：**不做心率自动暂停**（HUD 变色 + events 记录 beta-hr-high），RPE 主控强度
- RPE(CR10)：≥6 直接进休息界面（保守处置）；≥5 步频-8；≤2 步频+5；目标区间 3~4
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
- 多患者档案切换（当前一设备一患者假设，共用平板会串数据）
- kcal 按体重校正（需加体重输入，现固定 0.045 kcal/步）
- 真人踏步检测阈值标定（pose.js lift=-0.24 / plant=-0.09 系数未经大样本验证）

## 图片版权
assets/photos 12 张中 7 张来自 Unsplash/Pixabay/Pexels（许可宽松）；
xihu/erhai/taishan/potala 4 张来源待确认——公开发表/商用前替换，清单见 assets/photos/CREDITS.md

## Git
- 远程：github.com/Jayliu2025-vip/yunyou-shanhe（私有，main 分支）
