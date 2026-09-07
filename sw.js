/**
 * 云游山河 Service Worker（v1.3.4 离线缓存）
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
const VERSION = 'yysn-v1.3.4';
const CORE = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/config.js', './js/main.js', './js/game.js', './js/pose.js',
  './js/scenes.js', './js/audio.js', './js/hr.js', './js/storage.js',
  './vendor/vision_bundle.mjs', './vendor/pose_landmarker_lite.task',
  './assets/fonts/LXGWWenKaiGBScreen-Subset.woff2',
  './favicon.ico',
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
