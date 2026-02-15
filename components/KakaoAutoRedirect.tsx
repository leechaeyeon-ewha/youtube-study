"use client";

import { useEffect } from "react";
import { getIsKakaoBrowser } from "./KakaoBrowserBanner";

/** Android / iOS 구분 */
function getMobilePlatform(): "android" | "ios" | null {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document)) return "ios";
  return null;
}

/**
 * 카카오톡 인앱 브라우저에서 접속 시, 페이지 로드 직후 Chrome(Android) 또는 Safari(iOS)로 자동 이동.
 * - Android: intent URL로 Chrome 강제 오픈
 * - iOS: 외부 브라우저로 열기 시도 (카카오 정책에 따라 동작 안 할 수 있음 → 로그인/학생 페이지 배너로 유도)
 */
export default function KakaoAutoRedirect() {
  useEffect(() => {
    if (typeof window === "undefined" || !getIsKakaoBrowser()) return;

    const platform = getMobilePlatform();
    const scheme = window.location.protocol.replace(":", "");
    const path = window.location.pathname + window.location.search;
    const fullUrl = window.location.href;

    if (platform === "android") {
      const intentUrl = `intent://${window.location.host}${path}#Intent;package=com.android.chrome;scheme=${scheme};end;`;
      window.location.replace(intentUrl);
      return;
    }

    if (platform === "ios") {
      // iOS: 새 창으로 열기 시도. 카카오가 허용하면 Safari 등 외부 브라우저로 열릴 수 있음
      window.open(fullUrl, "_blank", "noopener,noreferrer");
      return;
    }
  }, []);

  return null;
}
