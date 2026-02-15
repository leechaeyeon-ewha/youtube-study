"use client";

import { useEffect } from "react";

/**
 * 서비스 워커 등록 — 설치형 PWA 요건 충족 (Chrome/Edge 앱 설치·앱 목록 등록).
 */
export default function PwaServiceWorkerRegister() {
  useEffect(() => {
    const isSecure =
      window.location.protocol === "https:" ||
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !isSecure
    ) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      })
      .catch(() => {});
  }, []);

  return null;
}
