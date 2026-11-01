"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const KEY_PREFIX = "youtube_study_view_state:";
const MAX_AGE_MS = 10 * 60 * 1000;
const SCROLL_RETRY_BUDGET_MS = 1000;

export type ViewUiValue = string | number | boolean | null;
export type ViewUiState = Record<string, ViewUiValue>;

type StoredPayload = {
  at: number;
  userId: string;
  pathname: string;
  scrollY: number;
  ui: ViewUiState;
};

function storageKey(pathname: string, userId: string): string {
  return `${KEY_PREFIX}${userId}:${pathname}`;
}

function isAllowedUiValue(v: unknown): v is ViewUiValue {
  if (v === null) return true;
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

function sanitizeUi(raw: unknown): ViewUiState | null {
  if (!raw || typeof raw !== "object") return null;
  const out: ViewUiState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isAllowedUiValue(v)) out[k] = v;
  }
  return out;
}

function scrollToYWithRetry(targetY: number, startTime: number): void {
  const attempt = () => {
    window.scrollTo(0, targetY);
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const elapsed = Date.now() - startTime;
    const reached = targetY <= maxScroll + 4 || elapsed >= SCROLL_RETRY_BUDGET_MS;
    if (!reached) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

export interface UseViewStateRestoreOptions {
  userId: string | null;
  ui: ViewUiState;
  /** 목록 데이터 등이 렌더 가능할 때 true */
  ready: boolean;
  applyUi: (ui: ViewUiState) => void;
  /** UI state 반영 직후 (펼침 lazy load 등) — 이후 scroll 복원 */
  afterUiRestore?: () => void | Promise<void>;
}

/**
 * 탭/앱 이탈 시 UI·scrollY를 sessionStorage에 저장하고,
 * 동일 pathname·userId로 리로드 후 ready가 되면 1회만 복원한다.
 */
export function useViewStateRestore(options: UseViewStateRestoreOptions): void {
  const { userId, ui, ready, applyUi, afterUiRestore } = options;
  const pathname = usePathname();
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const applyUiRef = useRef(applyUi);
  applyUiRef.current = applyUi;
  const afterRef = useRef(afterUiRestore);
  afterRef.current = afterUiRestore;
  const restoreStartedRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const removeStoredKey = useCallback(() => {
    if (!userId || !pathname) return;
    try {
      sessionStorage.removeItem(storageKey(pathname, userId));
    } catch {
      // ignore
    }
  }, [pathname, userId]);

  const save = useCallback(() => {
    if (!userId || !pathname || !readyRef.current) return;
    const payload: StoredPayload = {
      at: Date.now(),
      userId,
      pathname,
      scrollY: window.scrollY,
      ui: uiRef.current,
    };
    try {
      sessionStorage.setItem(storageKey(pathname, userId), JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [pathname, userId]);

  useEffect(() => {
    if (!ready || restoreStartedRef.current || !userId || !pathname) return;

    const key = storageKey(pathname, userId);
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      return;
    }
    if (!raw) return;

    restoreStartedRef.current = true;

    let parsed: StoredPayload;
    try {
      parsed = JSON.parse(raw) as StoredPayload;
    } catch {
      sessionStorage.removeItem(key);
      return;
    }

    if (parsed.userId !== userId || parsed.pathname !== pathname) return;
    if (!parsed.at || Date.now() - parsed.at > MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return;
    }

    const uiClean = sanitizeUi(parsed.ui);
    if (!uiClean) {
      sessionStorage.removeItem(key);
      return;
    }

    applyUiRef.current(uiClean);

    void (async () => {
      try {
        await afterRef.current?.();
      } finally {
        sessionStorage.removeItem(key);
        const y = Number(parsed.scrollY);
        if (Number.isFinite(y) && y >= 0) {
          scrollToYWithRetry(y, Date.now());
        }
      }
    })();
  }, [ready, userId, pathname]);

  useEffect(() => {
    if (!userId || !pathname) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        save();
      } else if (document.visibilityState === "visible") {
        removeStoredKey();
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) removeStoredKey();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", save);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", save);
    };
  }, [pathname, removeStoredKey, save, userId]);

  useEffect(() => {
    return () => {
      if (!userId || !pathname) return;
      if (!readyRef.current) return;
      if (restoreStartedRef.current) return;
      removeStoredKey();
    };
  }, [pathname, removeStoredKey, userId]);
}
