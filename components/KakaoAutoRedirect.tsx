"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  getIsInAppBrowser,
  getIsStandalone,
  KAKAO_REDIRECT_KEY,
} from "./KakaoBrowserBanner";

/** Android / iOS 구분 */
function getMobilePlatform(): "android" | "ios" | null {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document)) return "ios";
  return null;
}

function isAutoRedirectPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/login";
}

/**
 * 인앱 브라우저: "/"·"/login"에서만 탭당 한 번 Android Chrome Intent 시도.
 * 그 외 경로(시청 링크 등)는 배너만. iOS는 자동 전환 없음.
 */
export default function KakaoAutoRedirect() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (getIsStandalone()) return;
    if (!getIsInAppBrowser()) return;

    const path = pathname ?? window.location.pathname;
    if (!isAutoRedirectPath(path)) return;

    try {
      if (sessionStorage.getItem(KAKAO_REDIRECT_KEY) === "1") return;
      sessionStorage.setItem(KAKAO_REDIRECT_KEY, "1");
    } catch {
      return;
    }

    const platform = getMobilePlatform();
    if (platform !== "android") return;

    const scheme = window.location.protocol.replace(":", "");
    const urlPath = window.location.pathname + window.location.search;
    const intentUrl = `intent://${window.location.host}${urlPath}#Intent;package=com.android.chrome;scheme=${scheme};end;`;

    const t = setTimeout(() => {
      window.location.replace(intentUrl);
    }, 400);
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}
