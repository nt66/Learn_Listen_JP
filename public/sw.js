// Service Worker：页面离线可打开，听过的词库音频离线可重放。改动缓存策略时请升级 VERSION。
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const AUDIO = `audio-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icons/apple-touch-icon.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== SHELL && key !== AUDIO).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

// 优先走网络，失败时用缓存；成功的响应顺手写进缓存
async function networkFirst(request, cacheName, cacheKey = request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(cacheName)).put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') return event.respondWith(networkFirst(request, SHELL, '/'));
  // 构建产物文件名带 hash，内容不会变
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) return event.respondWith(cacheFirst(request));
  // 词库重新上传后音频可能变化，所以仍以网络为准，只在离线时用缓存
  if (/^\/api\/books\/[^/]+\/audio\/\d+$/.test(url.pathname)) return event.respondWith(networkFirst(request, AUDIO));
});
