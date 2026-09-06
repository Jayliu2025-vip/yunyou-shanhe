# vendor/ 第三方组件来源与许可

本目录下的文件为 **Google MediaPipe** 官方发行物的原样副本（未修改），
用于本地离线姿态识别，完全符合其 **Apache License 2.0** 授权
（完整许可文本见同目录 `LICENSE`）。

| 文件 | 说明 | 来源 |
|---|---|---|
| `pose_landmarker_lite.task` | Pose Landmarker（lite）模型，33 关键点 | Google MediaPipe 官方模型发行（storage.googleapis.com/mediapipe-models） |
| `vision_bundle.mjs` | MediaPipe Tasks Vision JS API 打包文件 | npm 包 `@mediapipe/tasks-vision` |
| `wasm/vision_wasm_internal.js/.wasm` | Vision 任务 WASM 运行时（SIMD 版） | 同上 |
| `wasm/vision_wasm_nosimd_internal.js/.wasm` | Vision 任务 WASM 运行时（非 SIMD 回退版） | 同上 |

- 上游项目：<https://github.com/google-ai-edge/mediapipe>（Copyright 2023 Google LLC）
- 许可证：Apache License 2.0（见 `vendor/LICENSE`，随本仓库一并分发以满足
  Apache 2.0 第 4 条"保留许可副本"的要求）
- 本项目对上述文件**未做任何修改**，仅本地化存放以实现完全离线运行
- 线性图标（`vendor/lucide/`，Lucide Icons）为 ISC License 原样副本，来源
  npm 包 lucide-static@0.544.0；实际以精简后的内联 SVG sprite 形式嵌入
  index.html（<symbol> 定义 + <use> 引用），本目录留存源文件与
  完整许可文本（LICENSE）以满足 ISC 第 3 条要求
- 音效素材（`assets/audio/`，Kenney「Interface Sounds」）为 CC0，见其目录内 CREDITS.md；
  照片素材许可见 `assets/photos/CREDITS.md`
