"use client";

import { useEffect } from "react";
import { getIsKakaoBrowser } from "./KakaoBrowserBanner";

const KAKAO_REDIRECT_KEY = "kakao_redirect_attempted";

/** Android / iOS 구분 */
function getMobilePlatform(): "android" | "ios" | null {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document)) return "ios";
  return null;
}

/**
 * 카카오톡 인앱 브라우저: 탭당 한 번만 외부 브라우저 열기 시도.
 * 재시도 방지로 깜빡임/충돌 방지. 실패 시 배너만 표시.
 */
export default function KakaoAutoRedirect() {
  useEffect(() => {
    if (typeof window === "undefined" || !getIsKakaoBrowser()) return;

    try {
      if (sessionStorage.getItem(KAKAO_REDIRECT_KEY) === "1") return;
      sessionStorage.setItem(KAKAO_REDIRECT_KEY, "1");
    } catch {
      return;
    }

    const platform = getMobilePlatform();
    const scheme = window.location.protocol.replace(":", "");
    const path = window.location.pathname + window.location.search;
    const fullUrl = window.location.href;

    const doRedirect = () => {
      if (platform === "android") {
        const intentUrl = `intent://${window.location.host}${path}#Intent;package=com.android.chrome;scheme=${scheme};end;`;
        window.location.replace(intentUrl);
        return;
      }
      if (platform === "ios") {
        window.open(fullUrl, "_blank", "noopener,noreferrer");
      }
    };

    const t = setTimeout(doRedirect, 400);
    return () => clearTimeout(t);
  }, []);

  return null;
}
