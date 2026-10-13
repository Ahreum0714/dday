// 앱 화면 파일만 저장해 두는 서비스 워커. 디데이 데이터(Supabase)는 저장하지 않아요.
// 앱 파일을 고친 뒤 올릴 때는 아래 버전 숫자를 하나 올려 주세요.
const VERSION = 'dday-v13';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

self.addEventListener('install', e => {
  // 브라우저에 남은 예전 파일이 아니라 서버의 최신 파일을 받아 저장
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })).concat([SUPABASE_JS])))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || req.url === SUPABASE_JS || url.href.startsWith('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@');
  if (!cacheable) return; // Supabase API 요청 등은 그대로 통과

  // 최신 화면 우선(브라우저 임시 저장분도 서버에 다시 확인), 오프라인이면 저장해 둔 화면
  const fresh = sameOrigin ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req);
  e.respondWith(
    fresh.then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: sameOrigin }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});

// 디데이 알림 받기
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '디데이', {
    body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: d.url || './' }
  }));
});

// 알림을 누르면 앱 열기
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) return w.focus(); }
    return clients.openWindow(target);
  }));
});
