import { NextResponse } from "next/server";

/**
 * PWA manifest를 인증 없이 API로 제공.
 * 배포 보호(Vercel 등)가 static 파일만 막는 환경에서 manifest 401 방지용.
 * public/manifest.json과 동일한 내용 유지.
 */
export async function GET() {
  const manifest = {
    id: "/",
    name: "영어는 김현정 영어전문학원",
    short_name: "김현정 영어",
    description: "영어는 김현정 영어전문학원 학원 학습관",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "portrait-primary",
    background_color: "#0f172a",
    theme_color: "#0f766e",
    categories: ["education"],
    prefer_related_applications: false,
    icons: [
      { src: "/pwa-icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
