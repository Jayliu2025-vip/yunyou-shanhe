# assets/fonts 字体来源与许可

## LXGWWenKaiGBScreen-Subset.woff2

- **字体**：霞鹜文楷 GB 屏读版（LXGW WenKai GB Screen）v1.522
- **作者**：LXGW（lxgw），基于 Fontworks **Klee One**（SIL OFL 1.1）衍生
- **许可**：SIL Open Font License 1.1 —— 详见同目录 `LICENSE-OFL.txt`
- **合规依据**：OFL 附加许可条款明确允许"仅为网页端渲染（Web Font）投递之目的
  进行子集化/格式转换（WOFF2）并保留保留字体名"，且不得再分发为可安装桌面字体 ——
  本项目仅在网页内以 webfont 方式加载，符合该条款。
- **处理**：`fontTools.subset` 按本项目实际用字（`tools/font-chars.txt`，1191 个中文
  字符 + 常用标点 + ASCII）子集化，不修改字形轮廓；全量 24MB → 子集约 326KB，
  随 Service Worker 预缓存，离线可用。
- **重新生成**：`python tools/build-font-subset.py`（需 Python3 + fonttools + brotli，
  自动拉取上游 TTF 并按最新界面文案重提字符集）
- **用途**：统一 iOS / 安卓（安卓微信无 KaiTi，原本会退化成宋体）/ 桌面端的
  楷体观感，用于标题、印章、通关文牒等楷体场景（`--font-kai` 字体栈首位）。
