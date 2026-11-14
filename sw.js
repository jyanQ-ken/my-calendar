'use strict';

/* ===== sw.js (Service Worker) =====
   アプリ本体(index.html・CSS・JS・アイコン)を、その機械に保存して、
   電波がなくても開けるようにするファイルです。

   しくみは「ネット優先」です。
   ・ネットにつながっているとき → いつも最新のファイルを取りにいく(保存してあるものも更新する)
   ・つながらない・遅いとき     → 保存してあるファイルを使う
   これで、アプリを直したときに古い画面が残りにくく、電波がなくても開けます。

   ※ 書いた内容(休み・印・予定メモ)は、ここには保存しません。
     これまでどおり、ブラウザの localStorage に、その機械の中だけで保存されます。
   ※ 保存するファイルの一覧は、index.html を読んで自動で見つけます。
     (ファイルを増やしたときに、ここを書き直さなくていいように)
*/

const CACHE_NAME = 'my-calendar-app-files';
const NETWORK_TIMEOUT_MS = 4000; // これより遅いときは、保存してあるファイルを先に使う

// ---------- インストール: アプリ本体を保存する ----------
async function precache() {
  const cache = await caches.open(CACHE_NAME);

  // index.html を読んで、使っているファイル(CSS・JS・アイコンなど)を自動で見つける
  const indexUrl = new URL('./index.html', self.registration.scope).href;
  const indexResponse = await fetch(new Request(indexUrl, { cache: 'reload' }));
  if (!indexResponse.ok) throw new Error('index.html を取得できませんでした');
  const html = await indexResponse.clone().text();

  const urls = new Set([new URL('./', self.registration.scope).href, indexUrl]);
  const pattern = /(?:href|src)="([^"#]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const url = new URL(match[1], indexUrl);
    if (url.origin === self.location.origin) urls.add(url.href);
  }

  await cache.put(indexUrl, indexResponse);
  await Promise.all(
    Array.from(urls)
      .filter(u => u !== indexUrl)
      .map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))
  );

  // 使わなくなった古いファイルを消す
  const keys = await cache.keys();
  await Promise.all(keys.filter(r => !urls.has(r.url)).map(r => cache.delete(r)));
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

// ---------- 有効になったとき: 古い保存場所を消して、すぐ使い始める ----------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// ---------- ファイルを求められたとき: ネット優先 ----------
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    // no-cache: ブラウザの一時保存ではなく、サーバーに「更新はある?」と必ず確かめる
    fetch(request, { cache: 'no-cache' }).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    // ネットにつながらない(または遅い) → 保存してあるものを使う
    const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const index = await cache.match(new URL('./index.html', self.registration.scope).href);
      if (index) return index;
    }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // 外部のものは扱わない(使っていませんが念のため)
  event.respondWith(networkFirst(request));
});
