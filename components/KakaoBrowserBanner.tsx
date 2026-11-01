"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** 카카오톡 인앱 브라우저 여부 (userAgent). 다른 페이지에서 PWA 배너 숨김 등에 사용 */
export function getIsKakaoBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /KAKAOTALK|KakaoTalk|kakaotalk/i.test(ua);
}

/** 클라이언트에서 카카오 브라우저 여부 (hydration 후 한 번만 체크) */
export function useIsKakaoBrowser(): boolean {
  const [isKakao, setIsKakao] = useState(false);
  useEffect(() => {
    setIsKakao(getIsKakaoBrowser());
  }, []);
  return isKakao;
}

/** 홈 화면에 추가된 PWA(standalone) 실행 여부 */
export function getIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/** 카카오 및 흔한 인앱 WebView (UA 휴리스틱) */
export function getIsInAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  if (getIsKakaoBrowser()) return true;
  return /FBAN|FBAV|FB_IAB|Instagram|NAVER|Naver\(inapp\)|Line\//i.test(ua);
}

export function useIsInAppBrowser(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(getIsInAppBrowser());
  }, []);
  return v;
}

/** Android / iOS 구분 */
function getMobilePlatform(): "android" | "ios" | null {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document)) return "ios";
  return null;
}

export const KAKAO_REDIRECT_KEY = "kakao_redirect_attempted";
export const INAPP_BANNER_DISMISS_KEY = "inapp_browser_banner_dismissed";

/**
 * 인앱 브라우저에서 접속 시 표시.
 * 자동 리다이렉트 시도 후에만 배너 표시해 깜빡임 방지(해당 경로만).
 */
export default function KakaoBrowserBanner() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [platform, setPlatform] = useState<"android" | "ios" | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [standalone, setStandalone] = useState(false);

  const isWatchRoute = pathname?.startsWith("/watch") ?? false;

  useEffect(() => {
    if (getIsStandalone()) {
      setStandalone(true);
      return;
    }
    if (!getIsInAppBrowser()) return;
    try {
      if (sessionStorage.getItem(INAPP_BANNER_DISMISS_KEY) === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      // ignore
    }
    const alreadyTriedRedirect = (() => {
      try {
        return sessionStorage.getItem(KAKAO_REDIRECT_KEY) === "1";
      } catch {
        return false;
      }
    })();
    const delayMs = alreadyTriedRedirect ? 0 : 600;
    const t = setTimeout(() => {
      setShow(true);
      setPlatform(getMobilePlatform());
    }, delayMs);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    try {
      sessionStorage.setItem(INAPP_BANNER_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const openInChrome = () => {
    const scheme = window.location.protocol.replace(":", "");
    const path = window.location.pathname + window.location.search;
    const intentUrl = `intent://${window.location.host}${path}#Intent;package=com.android.chrome;scheme=${scheme};end;`;
    window.location.href = intentUrl;
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (standalone) return null;
  if (dismissed || !show) return null;

  if (isWatchRoute && !expanded) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-900/30">
        <p className="min-w-0 flex-1 font-medium text-amber-900 dark:text-amber-100">
          Chrome·Safari에서 열면 학습 기록이 안전해요
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="shrink-0 text-xs font-medium text-amber-800 underline dark:text-amber-200"
        >
          자세히
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-800/50"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        isWatchRoute
          ? "rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/30"
          : "rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-amber-900 dark:text-amber-100">
          앱 안 브라우저보다 Chrome·Safari를 써 주세요
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-800/50"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
        여기서도 영상은 볼 수 있어요. 로그인·학습 기록은 브라우저마다 따로 저장될 수 있어요. Chrome이나
        Safari로 연 뒤 홈 화면에 추가하면 앱처럼 쓰기 좋아요.
      </p>
      {platform === "ios" && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          아이폰·카카오에서는 Safari로 바로 넘어가지 않을 수 있어요. <strong>주소 복사</strong> 후 Safari
          주소창에 붙여넣기 해 주세요.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {platform === "android" && (
          <button
            type="button"
            onClick={openInChrome}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            Chrome으로 열기
          </button>
        )}
        {platform === "ios" && (
          <button
            type="button"
            onClick={copyUrl}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            {copied ? "복사됨" : "주소 복사"}
          </button>
        )}
        {platform !== "android" && platform !== "ios" && (
          <a
            href={typeof window !== "undefined" ? window.location.href : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            브라우저로 열기
          </a>
        )}
        {isWatchRoute && expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-sm text-amber-800 underline dark:text-amber-200"
          >
            접기
          </button>
        )}
      </div>
    </div>
  );
}
