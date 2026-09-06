# 景点实景图片来源与许可说明

游戏内 13 张景点背景图（`assets/photos/*.jpg`，均为 16:9 裁剪版）来源如下。
**全部来自明确允许免费商用的来源**（Unsplash License / Pixabay Content License /
Pexels License，均无需署名）；2026-09 复核时已将最初来源不明的 4 张
（西湖/洱海/泰山/布达拉宫）替换为下列合规图片。

| 文件 | 景点 | 来源 | 许可 |
|---|---|---|---|
| xihu.jpg | 杭州西湖（保俶塔远眺） | Unsplash（photo 1658763094617-df6cec01a0b1） | Unsplash License（免费商用、无需署名） |
| huangshan.jpg | 黄山云海 | Unsplash | Unsplash License（免费商用、无需署名） |
| lijiang.jpg | 桂林漓江 | Unsplash | Unsplash License |
| zhangjiajie.jpg | 张家界 | Pixabay（作者 YHBae, photo/2019/07/23/07/23/zhangjiajie-4356771） | Pixabay Content License（免费商用、无需署名） |
| erhai.jpg | 大理洱海（白族村落与苍山） | Unsplash（photo 1678620071844-8377e26f1944） | Unsplash License |
| dunhuang.jpg | 敦煌鸣沙山 | Unsplash | Unsplash License |
| hulunbeir.jpg | 呼伦贝尔草原 | Pexels | Pexels License（免费商用、无需署名） |
| greatwall.jpg | 万里长城 | Pixabay（作者 JLB1988, photo/2017/12/16/16/37/great-wall-of-china-3022907） | Pixabay Content License |
| taishan.jpg | 泰山日出（玉皇顶远眺） | Pixabay（作者 JWKang, photo/2020/10/22/15/20/sunrise-5676316） | Pixabay Content License |
| gugong.jpg | 故宫 | Unsplash | Unsplash License |
| qinghaihu.jpg | 青海湖 | Pixabay（作者 jim39, photo/2016/06/22/12/20/qinghai-lake-1472877） | Pixabay Content License |
| potala.jpg | 布达拉宫 | Unsplash（photo 1741257091145-69d62cdf819a） | Unsplash License |
| wudang.jpg | 武当仙山（道观屋脊远眺群山） | Unsplash（作者 Kilian Murphy, photo 1704079552390-a8c87b188b5b, 页面 ID MGAIPRTa4Lo，定位武当山） | Unsplash License（免费商用、无需署名） |

Unsplash 图可直接以 CDN 裁剪参数复现：`https://images.unsplash.com/photo-<ID>?fm=jpg&q=80&w=1600&h=900&fit=crop`。

替换方法：准备一张横向风景照，裁成 16:9、宽约 1600px、JPEG 质量 80 左右，
覆盖 `assets/photos/` 下同名文件即可（改名后同步更新本表）。

若照片缺失或加载失败，游戏会自动回退为内置的程序化水墨风场景，不影响运行。
