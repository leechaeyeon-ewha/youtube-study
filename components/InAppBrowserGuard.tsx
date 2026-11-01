"use client";

import { useEffect, useState } from "react";
import KakaoAutoRedirect from "@/components/KakaoAutoRedirect";
import KakaoBrowserBanner, { getIsStandalone } from "@/components/KakaoBrowserBanner";

type Props = { className?: string };

/**
 * 인앱 WebView: 외부 브라우저 유도(자동 전환 + 배ner).
 * 홈 화면 PWA(standalone)에서는 아무 것도 하지 않음.
 */
export default function InAppBrowserGuard({ className }: Props) {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    if (getIsStandalone()) setStandalone(true);
  }, []);

  if (standalone) return null;

  return (
    <>
      <KakaoAutoRedirect />
      <div className={className}>
        <KakaoBrowserBanner />
      </div>
    </>
  );
}
