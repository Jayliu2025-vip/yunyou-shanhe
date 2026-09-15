/**
 * 云游山河 Service Worker（v1.4.0 离线缓存）
 *
 * 目的：手机（居家康复主力设备）二次打开秒开、弱网/断网仍可完整训练
 * （MediaPipe 模型与 WASM 均为本仓库本地文件，缓存后完全离线可用）。
 *
 * 策略：
 *  - 页面导航：网络优先，失败回退缓存（保证功能更新及时，断网也能进训练）
 *  - 静态资源（js/css/vendor/照片/音效/图标）：缓存优先 + 后台更新（stale-while-revalidate）
 *  - 仅缓存同源 GET；vendor/wasm 体积大（约19MB，SIMD/非SIMD两套）→ 不预缓存，
 *    首次在线使用时按需入缓存
 *
 * 更新版本号（与 CHANGELOG 同步）即可让旧缓存整体失效。
 */
const VERSION = 'yysn-v1.4.0-20260916-1';
const CORE = [
  './', './index.html', './manifest.json',
  './css/style.css', './css/theme.css',
  './js/session-safety.js', './js/rehab-plan.js', './js/art.js', './js/config.js', './js/main.js', './js/game.js', './js/pose.js',
  './js/scenes.js', './js/audio.js', './js/hr.js', './js/storage.js',
  './vendor/vision_bundle.mjs', './vendor/pose_landmarker_lite.task',
  './assets/fonts/LXGWWenKaiGBScreen-Subset.woff2',
  './favicon.ico',
  './assets/art/stamps/dunhuang-gold-token.svg',
  './assets/art/stamps/dunhuang-gold.svg',
  './assets/art/stamps/dunhuang-token.svg',
  './assets/art/stamps/dunhuang.svg',
  './assets/art/stamps/erhai-gold-token.svg',
  './assets/art/stamps/erhai-gold.svg',
  './assets/art/stamps/erhai-token.svg',
  './assets/art/stamps/erhai.svg',
  './assets/art/stamps/greatwall-gold-token.svg',
  './assets/art/stamps/greatwall-gold.svg',
  './assets/art/stamps/greatwall-token.svg',
  './assets/art/stamps/greatwall.svg',
  './assets/art/stamps/gugong-gold-token.svg',
  './assets/art/stamps/gugong-gold.svg',
  './assets/art/stamps/gugong-token.svg',
  './assets/art/stamps/gugong.svg',
  './assets/art/stamps/huangshan-gold-token.svg',
  './assets/art/stamps/huangshan-gold.svg',
  './assets/art/stamps/huangshan-token.svg',
  './assets/art/stamps/huangshan.svg',
  './assets/art/stamps/hulunbeir-gold-token.svg',
  './assets/art/stamps/hulunbeir-gold.svg',
  './assets/art/stamps/hulunbeir-token.svg',
  './assets/art/stamps/hulunbeir.svg',
  './assets/art/stamps/lijiang-gold-token.svg',
  './assets/art/stamps/lijiang-gold.svg',
  './assets/art/stamps/lijiang-token.svg',
  './assets/art/stamps/lijiang.svg',
  './assets/art/stamps/potala-gold-token.svg',
  './assets/art/stamps/potala-gold.svg',
  './assets/art/stamps/potala-token.svg',
  './assets/art/stamps/potala.svg',
  './assets/art/stamps/qinghaihu-gold-token.svg',
  './assets/art/stamps/qinghaihu-gold.svg',
  './assets/art/stamps/qinghaihu-token.svg',
  './assets/art/stamps/qinghaihu.svg',
  './assets/art/stamps/taishan-gold-token.svg',
  './assets/art/stamps/taishan-gold.svg',
  './assets/art/stamps/taishan-token.svg',
  './assets/art/stamps/taishan.svg',
  './assets/art/stamps/wudang-gold-token.svg',
  './assets/art/stamps/wudang-gold.svg',
  './assets/art/stamps/wudang-token.svg',
  './assets/art/stamps/wudang.svg',
  './assets/art/stamps/xihu-gold-token.svg',
  './assets/art/stamps/xihu-gold.svg',
  './assets/art/stamps/xihu-token.svg',
  './assets/art/stamps/xihu.svg',
  './assets/art/stamps/zhangjiajie-gold-token.svg',
  './assets/art/stamps/zhangjiajie-gold.svg',
  './assets/art/stamps/zhangjiajie-token.svg',
  './assets/art/stamps/zhangjiajie.svg',
  './assets/art/props/flower.svg',
  './assets/art/props/koi.svg',
  './assets/art/props/lantern.svg',
  './assets/art/props/traveler.svg',
  './assets/art/props/water.svg',

];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u)))) // 单个缺失不阻断安装
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 跨域（心率设备等）不拦截

  // 页面导航：网络优先，断网回退缓存
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
