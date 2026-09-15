# 景点纪念章与道具素材署名

## 第三方来源

Source: [Game-icons.net](https://game-icons.net/), [game-icons/icons repository](https://github.com/game-icons/icons).

License: [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).

Original SVG files are preserved under `sources/`. The exact upstream commit is recorded in `SOURCE_COMMIT.txt`.

| Author | Original icon | Used in |
|---|---|---|
| Delapouite | water-bottle | 旅行水瓶（裁掉玻璃杯、重新着色） |
| Delapouite | hiking | 旅行者（移除山地背景、增加手杖、重新着色与裁切） |
| Delapouite | mountain-road | 漓江主题章 |
| Delapouite | grass | 呼伦贝尔主题章 |
| Delapouite | sunrise | 泰山主题章 |
| Lorc | lotus | 西湖主题章、莲花道具 |
| Lorc | mountaintop | 黄山主题章 |

Changes to source icons: black backgrounds removed; foreground colors changed; artwork scaled and composed within original emblem frames. Icons remain thematic symbols, not architectural surveys or exact landmark depictions. No endorsement by the original authors is implied.

Attribution: **Icons by Delapouite and Lorc. Available on https://game-icons.net. Licensed under CC BY 3.0. Modified for 云游山河.**

## 本项目新增设计

纪念章外框、普通/金色配色、地名与编号布局、石林/长城/湖泊/沙丘/中式屋檐/宫殿图案、灯笼与锦鲤为本轮项目内新增的SVG设计。sources中的pagoda、desert、temple-gate仅保存作来源参考，未用于最终产物。未引入篆刻字体、微软素材或其他候选角色包。

构建方式：`python tools/build-emblems.py`。生成52个印章SVG（13景×普通/金色×完整/游戏小图）及5个道具SVG。SVG不含脚本、外链或外部字体。游戏通过同源Image资源在Canvas绘制；小图不含地名细字。
