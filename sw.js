// ===== 서비스 워커 =====
// 페이지와 별개로 실행되며, 네트워크 요청을 가로채 캐시로 응답할 수 있음.
// 덕분에 인터넷이 없어도 앱(HTML/CSS/JS)이 열림.

// 캐시 이름에 버전을 붙임 — 파일을 크게 바꿀 때 v2, v3...으로 올리면
// activate에서 옛 캐시가 삭제되면서 깨끗하게 갈아탈 수 있음
const CACHE = "cart-app-v1";

// 미리 캐시해 둘 "앱 껍데기" 파일들
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "data.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  // Supabase 라이브러리(CDN)도 캐시해야 오프라인에서 script.js가 안 죽음
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
];

// install: 서비스 워커가 처음 등록될 때 한 번 — 껍데기 파일을 전부 캐시
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // 새 버전이 오면 기다리지 않고 바로 교체
});

// activate: 새 버전이 활성화될 때 — 이름이 다른(=옛 버전) 캐시 삭제
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// fetch: 페이지의 모든 요청이 여기를 거침
self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // 데이터 요청(Supabase DB, 네이버 검색 프록시)은 캐시하지 않고 그대로 네트워크로.
  // 목록 데이터의 오프라인 처리는 script.js의 localStorage 캐시가 담당함
  if (
    e.request.method !== "GET" ||
    url.includes("supabase.co") ||
    url.includes("/api/")
  ) {
    return; // respondWith를 안 부르면 브라우저 기본 동작(네트워크)
  }

  // 껍데기 파일: stale-while-revalidate 전략
  // = 캐시에 있으면 즉시 그걸 주고(빠름/오프라인 OK),
  //   뒤에서 네트워크로 새 버전을 받아 캐시를 갱신(다음 방문에 반영)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone(); // 응답은 한 번만 읽을 수 있어 복제
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit); // 네트워크 실패(오프라인)면 캐시라도
      return hit || refresh;
    })
  );
});
