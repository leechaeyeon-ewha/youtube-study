/**
 * 설치형 PWA용 최소 서비스 워커.
 * Chrome/Edge 설치 요건 충족 및 앱 목록 등록용.
 */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  /* 네트워크 우선: 별도 캐시 없이 통과 */
});
