# PWA 아이콘 가이드

설치형 PWA가 Android·iOS 앱 목록/홈 화면에서 정식 앱처럼 보이도록 아이콘을 준비하는 방법입니다.

---

## 현재 설정

- **Manifest**: `public/manifest.json` — `display: standalone`, `short_name`, `start_url`, `scope`, `icons`(any + maskable)
- **iOS**: `app/layout.tsx` — `apple-touch-icon` 120×120, 152×152, 167×167, 180×180 (모두 `/pwa-icon.png` 참조)
- **서비스 워커**: `public/sw.js` — 설치형 PWA 요건 충족용 최소 SW

---

## Android — 적응형 아이콘 (Maskable)

- **목적**: `purpose: "maskable"` — 기기별로 원형/둥근 사각 등 마스크가 적용되므로 **중앙 80% 안전 영역** 안에 핵심 요소를 두세요.
- **권장 크기**: 512×512 px (PNG, 투명 또는 단색 배경)
- **적용**:  
  - 현재는 `public/pwa-icon.png`를 maskable로도 사용 중입니다.  
  - 전용 마스커블 아이콘을 쓰려면 512×512로 안전 영역을 지킨 이미지를 만든 뒤  
    `public/icons/icon-maskable-512.png`에 넣고, `public/manifest.json`의 `purpose: "maskable"` 항목의 `src`를 `/icons/icon-maskable-512.png`로 바꾸면 됩니다.

---

## iOS — 전용 아이콘 (apple-touch-icon)

- **목적**: 홈 화면 추가 시 사용되는 아이콘. 기기/해상도별로 가장 맞는 크기가 있음.
- **권장 크기** (각각 별도 파일 권장):
  - 180×180 — iPhone
  - 167×167 — iPad Pro
  - 152×152 — iPad
  - 120×120 — iPhone (일부)
- **적용**:  
  - 현재는 `app/layout.tsx`에서 위 크기 모두 `/pwa-icon.png`를 참조합니다.  
  - 기기별로 더 선명하게 하려면 `public/icons/` 아래에  
    `apple-touch-icon-180.png`, `apple-touch-icon-167.png`, `apple-touch-icon-152.png`, `apple-touch-icon-120.png`  
    등을 두고, `layout.tsx`의 `<link rel="apple-touch-icon" sizes="…" href="…" />`를 해당 경로로 수정하면 됩니다.

---

## 요약

| 플랫폼 | 용도 | 권장 크기 | 현재 파일 |
|--------|------|-----------|-----------|
| Android | any | 192, 512 | `/pwa-icon.png` |
| Android | maskable | 512 (안전 영역 80%) | `/pwa-icon.png` (전용 파일로 교체 가능) |
| iOS | apple-touch-icon | 120, 152, 167, 180 | `/pwa-icon.png` (전용 파일로 교체 가능) |

현재는 `public/pwa-icon.png` 하나로 모두 처리되며, 위 가이드대로 전용 파일을 추가하면 품질을 더 높일 수 있습니다.
