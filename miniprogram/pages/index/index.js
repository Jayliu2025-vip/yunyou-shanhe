// 云游山河 H5 宿主页：web-view 加载已部署的游戏地址
//
// 接入步骤（详见仓库 README 第七节）：
// 1. 把 H5（index.html + css/ + js/ + assets/ + vendor/）部署到已 HTTPS 备案的域名，
//    例如 https://rehab.example.edu.cn/yunyou/
// 2. 将下方 H5_URL 替换为该完整地址（必须 https，且在小程序"业务域名"白名单内）
// 3. 微信公众平台（mp.weixin.qq.com）→ 开发管理 → 开发设置 → 业务域名：
//    添加该域名，并按提示下载校验文件放到网站根目录
// 4. 微信开发者工具导入本 miniprogram/ 目录，替换 project.config.json 的 appid 后预览
//
// 注意：
// - web-view 组件要求**企业主体**小程序（个人主体不可用）
// - 微信 web-view 内 getUserMedia（摄像头）在 iOS/部分安卓版本受限，
//   H5 已内置"微信内引导 + 演示模式"降级；正式患者使用建议真机实测，
//   若摄像头不可用可走原生迁移路径（wx.createVKSession，见 README 第七节）
const H5_URL = 'https://REPLACE-WITH-YOUR-DEPLOYED-GAME-URL/index.html';

Page({
  data: {
    url: H5_URL,
    configured: /^https:\/\//.test(H5_URL) && H5_URL.indexOf('REPLACE') === -1,
  },

  onLoad() {
    if (!this.data.configured) {
      wx.showModal({
        title: '请先配置 H5 地址',
        content: '在 pages/index/index.js 中把 H5_URL 替换为已部署并加入小程序业务域名的游戏地址（步骤见仓库 README 第七节）。',
        showCancel: false,
      });
    }
    // 同时开放「发送给朋友」与「分享到朋友圈」入口
    if (wx.showShareMenu) {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  // H5 可在关键时刻调用 wx.miniProgram.postMessage({ data: {...} })
  // （目前仅在小程序后退、组件销毁、分享时触发；用于训练完成上报等扩展）
  onMessage(e) {
    console.log('[web-view message]', e.detail && e.detail.data);
  },

  onShareAppMessage() {
    return {
      title: '云游山河 · 心脏康复集章之旅',
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: '云游山河 · 心脏康复集章之旅',
    };
  },
});
