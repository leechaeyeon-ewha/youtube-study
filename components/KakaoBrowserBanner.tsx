"use client";

import { useEffect, useState } from "react";

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

/** Android / iOS 구분 */
function getMobilePlatform(): "android" | "ios" | null {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document)) return "ios";
  return null;
}

/**
 * 카카오톡 인앱 브라우저에서 접속 시 표시.
 * Chrome/Safari로 열기 유도 (PWA 설치·쾌적한 이용을 위해).
 */
export default function KakaoBrowserBanner() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<"android" | "ios" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!getIsKakaoBrowser()) return;
    setShow(true);
    setPlatform(getMobilePlatform());
  }, []);

  const openInChrome = () => {
    const scheme = window.location.protocol.replace(":", "");
    const path = window.location.pathname + window.location.search;
    const intentUrl = `intent://${window.location.host}${path}#Intent;package=com.android.chrome;scheme=${scheme};end;`;
    window.location.href = intentUrl;
  };

  /** Safari로 열기: 새 창으로 현재 URL. 카카오가 외부 브라우저 선택지 줄 수 있음 */
  const openInSafari = () => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
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

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
      <p className="font-semibold text-amber-900 dark:text-amber-100">
        카카오톡 브라우저에서는 앱 설치가 되지 않습니다.
      </p>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
        Chrome(또는 Safari)으로 열어주시면 <strong>앱 설치</strong>와 더 쾌적한 이용이 가능합니다.
      </p>
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
          <>
            <button
              type="button"
              onClick={openInSafari}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
            >
              Safari로 열기
            </button>
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-lg border border-amber-600 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-500 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/30"
            >
              {copied ? "복사됨" : "주소 복사 (Safari에 붙여넣기)"}
            </button>
          </>
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
      </div>
    </div>
  );
}
