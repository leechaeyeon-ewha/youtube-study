"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import {
  COMPLETE_THRESHOLD_PERCENT,
  mergeIntervals,
  normalizeIntervals,
  percentFromIntervals,
  type WatchedInterval,
} from "@/lib/watchIntervals";
import { fetchProgressWithRetry, warnProgressFailure } from "@/lib/progressRetry";
import { clearWatchSessionPosition, saveWatchSessionPosition } from "@/lib/watchSessionRestore";
import { postEmbedFailureLog, type EmbedEventKind } from "@/lib/embedFailureLog";
import { getIsStandalone } from "@/components/KakaoBrowserBanner";

const SKIP_TOLERANCE_SEC = 0.5;
const MAX_PLAYBACK_RATE = 1.4;

/** MAX_PLAYBACK_RATE 이하인 getAvailablePlaybackRates 값 중 최대. 없으면 1(공식: 비지원 값은 1 방향으로 스냅). */
function resolveCappedPlaybackRate(p: YTPlayer): number {
  try {
    const rates = p.getAvailablePlaybackRates?.();
    if (Array.isArray(rates) && rates.length > 0) {
      const within = rates.filter(
        (r) => typeof r === "number" && Number.isFinite(r) && r <= MAX_PLAYBACK_RATE
      );
      if (within.length > 0) return Math.max(...within);
    }
  } catch {
    // ignore
  }
  return 1;
}

const PROGRESS_SAVE_INTERVAL_MS = 5000;
/** 배속 체크 주기: 너무 짧으면 오류·깜빡임 유발 가능 → 1초로 완화 */
const RATE_CHECK_INTERVAL_MS = 1000;
const RATE_TOAST_MESSAGE = "배속은 1.25배속까지만 사용 가능합니다.";
const TOAST_DURATION_MS = 2500;
const TOAST_COOLDOWN_MS = 8000;
const READY_TIMEOUT_MS = 12_000;
/** 플레이어 생성 직후 이 시간까지만 onApiChange로 자막 OFF 재시도 */
const CAPTIONS_DISABLE_WINDOW_MS = 5000;

/** iframe 위 터치 차단 구역(위치·clamp 크기는 여기만 조정) */
const OVERLAY_ZONES = {
  topLeft: {
    /** 좌상단 채널·제목. 우측 176px(right-44)는 음량·CC·설정 */
    className: "absolute left-0 top-0 right-44 z-10 h-14 cursor-default sm:h-16",
  },
  bottomLeft: {
    /** 좌하단 공유·나중에 볼 동영상. bottom-1: 앱 진도 h-1과 겹침 방지. 시크(하단 ~70–110px) 양끝과 겹치면 스크럽이 어려울 수 있음 */
    className: "absolute bottom-1 left-0 z-10 cursor-default",
    size: {
      width: "clamp(9rem, 20%, 14rem)",
      height: "clamp(60px, 11%, 96px)",
    },
  },
  bottomRight: {
    /** 우하단 YouTube 로고(큰 알약 ~200px 등). max 높이 96px. 세로 화면 CC·설정과 겹칠 수 있음. 시크 양끝 터치 간섭 가능 */
    className: "absolute bottom-1 right-0 z-10 cursor-default",
    size: {
      width: "clamp(11rem, 26%, 20rem)",
      height: "clamp(60px, 11%, 96px)",
    },
  },
} as const;

function overlayShieldClass(base: string, debug: boolean): string {
  if (!debug) return base;
  return `${base} border border-red-600 bg-red-500/40`;
}

type PlaybackFailure = {
  kind: EmbedEventKind;
  errorCode?: number;
  offline?: boolean;
};

function getYtEmbedHost(): string | undefined {
  return process.env.NEXT_PUBLIC_YT_EMBED_HOST === "nocookie"
    ? "https://www.youtube-nocookie.com"
    : undefined;
}

function getPlaybackFailureMessage(failure: PlaybackFailure): { title: string; extra?: string } {
  if (failure.kind === "ready_timeout" && failure.offline) {
    return { title: "인터넷 연결을 확인해 주세요." };
  }
  if (failure.kind === "ready_timeout") {
    return {
      title: "영상 준비가 오래 걸리고 있어요.",
      extra: "잠시 후 아래 ‘다시 시도’를 눌러 보세요.",
    };
  }
  if (failure.kind === "user_report") {
    return {
      title: "영상이 보이지 않는다고 알려 주셨어요.",
      extra: "아래 ‘다시 시도’를 눌러 보세요.",
    };
  }
  return {
    title: "영상을 불러오지 못했어요.",
    extra: "아래 ‘다시 시도’를 눌러 보세요.",
  };
}

function progressDebug(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.log(...args);
  }
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          height: string;
          width: string;
          videoId: string;
          host?: string;
          playerVars: Record<string, string | number>;
          events: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number }) => void;
            onError?: (e: { data: number }) => void;
            onApiChange?: () => void;
          };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getAvailablePlaybackRates?: () => number[];
  destroy: () => void;
  getOptions?: (module: string) => string[];
  setOption?: (module: string, option: string, value: unknown) => void;
}

interface Props {
  videoId: string;
  assignmentId: string;
  initialPosition?: number;
  /** 서버에 저장된 병합 시청 구간 */
  initialWatchedIntervals?: WatchedInterval[];
  /** 저장된 진도율 (0~100) — UI 초기 표시용 */
  initialProgressPercent?: number;
  /** true: 건너뛰기 방지(기본), false: 건너뛰기 허용 — 허용 시 실제 재생한 시간만 진도에 반영 */
  preventSkip?: boolean;
  /** 진도율이 1% 이상이 되는 순간 한 번만 호출 (최초 시청 시작 기록용) */
  onFirstProgress?: () => void;
}

function getPageOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function getOriginFromIframeApiScript(script: HTMLScriptElement): string | null {
  try {
    return new URL(script.src).searchParams.get("origin");
  } catch {
    return null;
  }
}

/** 이전 배포 URL 등으로 로드된 iframe_api 스크립트·YT 전역 상태 제거 */
function resetYoutubeAPIState(): void {
  document.querySelectorAll('script[src*="youtube.com/iframe_api"]').forEach((el) => el.remove());
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
}

function loadYoutubeAPI(): Promise<NonNullable<Window["YT"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));

  const origin = getPageOrigin();
  const scriptSrc = origin
    ? `https://www.youtube.com/iframe_api?origin=${encodeURIComponent(origin)}`
    : "https://www.youtube.com/iframe_api";

  const existing = document.querySelector(
    'script[src*="youtube.com/iframe_api"]'
  ) as HTMLScriptElement | null;

  if (existing) {
    const scriptOrigin = getOriginFromIframeApiScript(existing);
    if (origin && scriptOrigin !== origin) {
      progressDebug("[youtube] iframe_api origin mismatch — reload", {
        scriptOrigin,
        currentOrigin: origin,
      });
      resetYoutubeAPIState();
    } else if (window.YT?.Player) {
      return Promise.resolve(window.YT);
    } else {
      return new Promise((resolve, reject) => {
        const check = () => (window.YT?.Player ? resolve(window.YT!) : setTimeout(check, 50));
        check();
        setTimeout(() => {
          if (!window.YT?.Player) reject(new Error("YT not loaded"));
        }, 15000);
      });
    }
  }

  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = scriptSrc;
    tag.async = true;
    if (origin) tag.dataset.ytOrigin = origin;
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);

    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) resolve(window.YT);
      else reject(new Error("YT not loaded"));
    };

    tag.onerror = () => reject(new Error("Failed to load YouTube API"));
  });
}

const FIRST_PROGRESS_THRESHOLD = 1;

/** 스킵 방지 ON — 이미 시청한 구간 끝까지는 탐색 허용 */
function initialMaxWatchedSec(
  position: number,
  intervals: WatchedInterval[],
  skipLock: boolean
): number {
  if (!skipLock) return position;
  const merged = mergeIntervals(normalizeIntervals(intervals));
  const maxEnd = merged.reduce((max, [, end]) => Math.max(max, end), 0);
  return Math.max(position, maxEnd);
}

export default function YoutubePlayer({
  videoId,
  assignmentId,
  initialPosition = 0,
  initialWatchedIntervals = [],
  initialProgressPercent = 0,
  preventSkip = true,
  onFirstProgress,
}: Props) {
  const initialMaxWatched = initialMaxWatchedSec(
    initialPosition,
    initialWatchedIntervals,
    preventSkip
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [ready, setReady] = useState(false);
  const [embedError, setEmbedError] = useState(false);
  const [playbackFailure, setPlaybackFailure] = useState<PlaybackFailure | null>(null);
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const [isStandalonePwa, setIsStandalonePwa] = useState(false);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerReadyRef = useRef(false);
  const maxWatchedRef = useRef(initialMaxWatched);
  const lastCurrentRef = useRef(initialPosition);
  const lastPlayingPositionRef = useRef(initialPosition);
  const durationRef = useRef(0);
  const savedProgressRef = useRef(Math.min(100, Math.max(0, initialProgressPercent)));
  const lastSavedPercentRef = useRef(savedProgressRef.current);
  const lastSaveTimeRef = useRef(0);
  const [progressPercent, setProgressPercent] = useState(savedProgressRef.current);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skipAlertCooldownRef = useRef(0);
  const lastKnownRateRef = useRef<number>(1);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabHiddenRef = useRef(false);
  const maxWatchedWhenHiddenRef = useRef(initialMaxWatched);
  const justBecameVisibleRef = useRef(false);
  const hasFiredFirstProgressRef = useRef(false);
  const lastSaveVideoPositionRef = useRef(initialPosition);
  const lastAuthTokenRef = useRef<string | null>(null);
  const lastProgressPayloadKeyRef = useRef<string | null>(null);
  const watchedIntervalsRef = useRef<WatchedInterval[]>(mergeIntervals(normalizeIntervals(initialWatchedIntervals)));
  const segmentStartRef = useRef(initialPosition);
  const segmentOpenRef = useRef(false);
  const isCompletedRef = useRef(savedProgressRef.current >= COMPLETE_THRESHOLD_PERCENT);
  const preventSkipRef = useRef(preventSkip);
  const initialSeekRef = useRef(initialPosition);
  const appliedInitialSeekForVideoRef = useRef<string | null>(null);
  const lastKnownTimeRef = useRef(initialPosition);
  const finalizeSegmentRef = useRef<(endSec: number) => void>(() => {});

  useEffect(() => {
    initialSeekRef.current = initialPosition;
    lastKnownTimeRef.current = initialPosition;
    appliedInitialSeekForVideoRef.current = null;
  }, [videoId, initialPosition]);

  const resolveResumeSeekSec = useCallback((): number => {
    const known = lastKnownTimeRef.current;
    if (Number.isFinite(known) && known > 0) return known;
    const initial = initialSeekRef.current;
    return Number.isFinite(initial) && initial > 0 ? initial : 0;
  }, []);

  useEffect(() => {
    preventSkipRef.current = preventSkip;
    const maxW = initialMaxWatchedSec(initialPosition, initialWatchedIntervals, preventSkip);
    maxWatchedRef.current = maxW;
    maxWatchedWhenHiddenRef.current = maxW;
  }, [preventSkip, initialPosition, initialWatchedIntervals]);

  useEffect(() => {
    maxWatchedRef.current = initialMaxWatchedSec(
      initialPosition,
      initialWatchedIntervals,
      preventSkipRef.current
    );
    maxWatchedWhenHiddenRef.current = maxWatchedRef.current;
    lastCurrentRef.current = initialPosition;
    lastPlayingPositionRef.current = initialPosition;
  }, [initialPosition, initialWatchedIntervals]);

  useEffect(() => {
    watchedIntervalsRef.current = mergeIntervals(normalizeIntervals(initialWatchedIntervals));
  }, [initialWatchedIntervals]);

  useEffect(() => {
    lastSaveVideoPositionRef.current = initialPosition;
  }, [initialPosition]);

  const getAccumulatedPercent = (duration: number): number => {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const intervals = watchedIntervalsRef.current;
    if (intervals.length > 0 || segmentOpenRef.current) {
      const start = segmentStartRef.current;
      const end = lastCurrentRef.current;
      const openSeg =
        segmentOpenRef.current && Number.isFinite(start) && Number.isFinite(end) && end > start
          ? ([start, end] as WatchedInterval)
          : null;
      return percentFromIntervals(intervals, duration, openSeg);
    }
    if (preventSkipRef.current) {
      return (maxWatchedRef.current / duration) * 100;
    }
    return 0;
  };

  const getOpenSegment = useCallback((): WatchedInterval | null => {
    if (!segmentOpenRef.current) return null;
    const start = segmentStartRef.current;
    const end = lastCurrentRef.current;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return [start, end];
  }, []);

  const finalizeSegment = useCallback((endSec: number) => {
    if (!segmentOpenRef.current) return;
    const start = segmentStartRef.current;
    if (Number.isFinite(endSec) && endSec > start + 0.2) {
      watchedIntervalsRef.current = mergeIntervals([
        ...watchedIntervalsRef.current,
        [start, endSec],
      ]);
    }
    segmentOpenRef.current = false;
  }, []);
  finalizeSegmentRef.current = finalizeSegment;

  const openSegment = useCallback((startSec: number) => {
    if (!Number.isFinite(startSec) || startSec < 0) return;
    segmentStartRef.current = startSec;
    segmentOpenRef.current = true;
  }, []);

  const detectSeekBreak = useCallback((prev: number, current: number) => {
    return Math.abs(current - prev) > 1.5;
  }, []);

  const computePercent = (duration: number): number => getAccumulatedPercent(duration);

  const getAccessToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    if (!forceRefresh && lastAuthTokenRef.current) {
      return lastAuthTokenRef.current;
    }
    if (!supabase) return null;
    const cached = getAccessTokenSync();
    if (cached) {
      lastAuthTokenRef.current = cached;
      return cached;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;
    lastAuthTokenRef.current = token;
    return token;
  }, []);

  const postProgress = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!supabase || !assignmentId?.trim()) return;
      try {
        const payloadKey = JSON.stringify(payload);
        if (payloadKey === lastProgressPayloadKeyRef.current) {
          progressDebug("[progress-debug] POST skipped (unchanged payload)");
          return;
        }

        let token = await getAccessToken();
        if (!token) return;

        progressDebug("[progress-debug] POST /api/progress", payload);
        let res = await fetchProgressWithRetry("/api/progress", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: payloadKey,
        });

        if (res.status === 401) {
          token = await getAccessToken(true);
          if (!token) return;
          res = await fetchProgressWithRetry("/api/progress", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: payloadKey,
          });
        }

        if (res.ok) {
          lastProgressPayloadKeyRef.current = payloadKey;
        } else {
          const body = await res.json().catch(() => ({}));
          warnProgressFailure("[progress] POST failed", { status: res.status, body });
        }
      } catch (err) {
        warnProgressFailure("[progress] POST network error", err);
      }
    },
    [assignmentId, getAccessToken]
  );

  const saveProgress = useCallback(
    async (percent: number, completed: boolean, lastPositionSeconds: number) => {
      if (!assignmentId?.trim()) return;
      if (!Number.isFinite(lastPositionSeconds) || lastPositionSeconds < 0) return;

      const duration = durationRef.current;
      const now = new Date().toISOString();
      const mergedIntervals = mergeIntervals(watchedIntervalsRef.current);
      const openSeg = getOpenSegment();
      const useIntervalPath =
        mergedIntervals.length > 0 || (openSeg != null && duration > 0);

      if (useIntervalPath && duration > 0) {
        const intervalsToSend =
          openSeg && openSeg[1] > openSeg[0]
            ? mergeIntervals([...mergedIntervals, openSeg])
            : mergedIntervals;
        const calculatedPercent = percentFromIntervals(intervalsToSend, duration);
        const progressPercent = isCompletedRef.current
          ? Math.max(savedProgressRef.current, 100)
          : Math.min(100, Math.max(0, Math.round(calculatedPercent * 100) / 100));
        if (!Number.isFinite(progressPercent)) return;

        const newCompleted =
          isCompletedRef.current || progressPercent >= COMPLETE_THRESHOLD_PERCENT;
        if (newCompleted) isCompletedRef.current = true;

        await postProgress({
          assignmentId: assignmentId as string,
          watched_intervals: intervalsToSend,
          duration_sec: duration,
          progress_percent: progressPercent,
          is_completed: newCompleted,
          last_position: lastPositionSeconds,
          last_watched_at: now,
        });
        return;
      }

      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
      if (percent === 0 && lastPositionSeconds === 0 && !completed) return;

      const progressPercent = isCompletedRef.current
        ? Math.max(savedProgressRef.current, 100)
        : Math.min(100, Math.round(percent * 100) / 100);
      const newCompleted =
        isCompletedRef.current || progressPercent >= COMPLETE_THRESHOLD_PERCENT;
      if (newCompleted) isCompletedRef.current = true;

      await postProgress({
        assignmentId: assignmentId as string,
        progress_percent: progressPercent,
        is_completed: newCompleted,
        last_position: lastPositionSeconds,
        last_watched_at: now,
      });
    },
    [assignmentId, getOpenSegment, postProgress]
  );

  const saveProgressRef = useRef(saveProgress);
  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  useEffect(() => {
    setIsClient(true);
    setIsStandalonePwa(getIsStandalone());
  }, []);

  const clearReadyTimer = useCallback(() => {
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  }, []);

  const reportEmbedFailure = useCallback(
    (eventKind: EmbedEventKind, errorCode?: number) => {
      postEmbedFailureLog({
        assignmentId: assignmentId as string,
        videoId,
        eventKind,
        errorCode,
      });
    },
    [assignmentId, videoId]
  );

  const handlePlaybackRetry = useCallback(() => {
    clearReadyTimer();
    playerReadyRef.current = false;
    setPlaybackFailure(null);
    setEmbedError(false);
    setReady(false);
    resetYoutubeAPIState();
    if (playerRef.current?.destroy) {
      try {
        playerRef.current.destroy();
      } catch {
        // ignore
      }
    }
    playerRef.current = null;
    setPlayerEpoch((n) => n + 1);
  }, [clearReadyTimer]);

  const handleUserReportPlayback = useCallback(() => {
    reportEmbedFailure("user_report");
    setPlaybackFailure({ kind: "user_report" });
  }, [reportEmbedFailure]);

  const sendWatchSegment = useCallback(
    async (startSec: number, endSec: number) => {
      if (!supabase || !assignmentId?.trim()) return;
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return;
      try {
        let token = await getAccessToken();
        if (!token) return;
        let res = await fetch("/api/watch-segments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            assignmentId: assignmentId as string,
            segments: [{ start_sec: startSec, end_sec: endSec }],
          }),
        });
        if (res.status === 401) {
          token = await getAccessToken(true);
          if (!token) return;
          await fetch("/api/watch-segments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              assignmentId: assignmentId as string,
              segments: [{ start_sec: startSec, end_sec: endSec }],
            }),
          });
        }
      } catch {
        // ignore
      }
    },
    [assignmentId, getAccessToken]
  );

  useEffect(() => {
    if (!isClient || !containerRef.current || !videoId) return;

    let mounted = true;
    let player: YTPlayer | null = null;
    playerReadyRef.current = false;
    let captionsDisableDone = false;
    const playerCreatedAt = Date.now();
    clearReadyTimer();

    loadYoutubeAPI()
      .then((YT) => {
        if (!mounted || !containerRef.current) return;

        const pageOrigin = getPageOrigin();
        const pageHref = window.location.href;
        const resumeSec = resolveResumeSeekSec();
        const startSec = Math.floor(resumeSec);
        const embedHost = getYtEmbedHost();
        player = new YT.Player(containerRef.current, {
          height: "100%",
          width: "100%",
          videoId,
          ...(embedHost ? { host: embedHost } : {}),
          playerVars: {
            origin: pageOrigin,
            widget_referrer: pageHref,
            enablejsapi: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            fs: 0,
            // modestbranding: 로고·브랜딩 축소(플랫폼·정책에 따라 효과가 제한적일 수 있음)
            modestbranding: 1,
            // cc_load_policy=0: 공식 문서는 값 1(켜기)만 명시, 0은 관행적 OFF 시도. 완전 보장은 API 보조 필요
            cc_load_policy: 0,
            start: startSec,
          },
          events: {
            onApiChange: () => {
              if (!mounted || captionsDisableDone) return;
              if (Date.now() - playerCreatedAt > CAPTIONS_DISABLE_WINDOW_MS) return;
              const p = playerRef.current;
              if (!p) return;
              try {
                const captionOpts = p.getOptions?.("captions");
                if (!Array.isArray(captionOpts) || captionOpts.length === 0) return;
                // 비공식: IFrame API 문서에는 captions.track 미기재. unloadModule은 사용하지 않음
                p.setOption?.("captions", "track", {});
                captionsDisableDone = true;
              } catch {
                // ignore
              }
            },
            onReady: (event: { target: YTPlayer }) => {
              if (!mounted) return;
              clearReadyTimer();
              playerReadyRef.current = true;
              setPlaybackFailure(null);
              playerRef.current = event.target;
              const p = event.target;
              const seekSec = resolveResumeSeekSec();
              if (
                appliedInitialSeekForVideoRef.current !== videoId &&
                Number.isFinite(seekSec) &&
                seekSec > 0
              ) {
                p.seekTo(seekSec, true);
                appliedInitialSeekForVideoRef.current = videoId;
                lastKnownTimeRef.current = seekSec;
              }
              try {
                p.setPlaybackRate(1);
              } catch {
                // ignore
              }
              try {
                // 비공식: onReady 1회만 시도. captionsDisableDone은 onApiChange(c)에서만 true
                p.setOption?.("captions", "track", {});
              } catch {
                // ignore
              }
              setReady(true);
            },
            onError: (e: { data: number }) => {
              if (!mounted) return;
              clearReadyTimer();
              playerReadyRef.current = false;
              const code = Number(e.data);
              setPlaybackFailure({
                kind: "error",
                errorCode: Number.isFinite(code) ? code : undefined,
              });
              reportEmbedFailure("error", Number.isFinite(code) ? code : undefined);
            },
            onStateChange: (e: { data: number }) => {
              if (!mounted) return;
              if (!playerRef.current) return;
              try {
                const p = playerRef.current;
                if (e.data !== 1) {
                  const endSec = lastPlayingPositionRef.current;
                  if (Number.isFinite(endSec)) finalizeSegmentRef.current(endSec);
                }

                if (e.data === 0) {
                  clearWatchSessionPosition(assignmentId);
                  const d = p.getDuration() || durationRef.current;
                  if (d > 0) durationRef.current = d;
                  const accumulated = d > 0 ? getAccumulatedPercent(d) : 0;
                  if (accumulated >= COMPLETE_THRESHOLD_PERCENT) {
                    isCompletedRef.current = true;
                    setProgressPercent(Math.min(100, accumulated));
                    const lastPos = preventSkipRef.current
                      ? maxWatchedRef.current
                      : lastPlayingPositionRef.current;
                    void saveProgressRef.current(accumulated, true, lastPos);
                  }
                }

                const r = p.getPlaybackRate();
                if (typeof r === "number" && Number.isFinite(r) && r > MAX_PLAYBACK_RATE) {
                  p.setPlaybackRate(resolveCappedPlaybackRate(p));
                }
              } catch {
                // ignore
              }
            },
          },
        }) as unknown as YTPlayer;

        readyTimerRef.current = setTimeout(() => {
          if (!mounted || playerReadyRef.current) return;
          const offline = typeof navigator !== "undefined" && !navigator.onLine;
          setPlaybackFailure({ kind: "ready_timeout", offline });
          reportEmbedFailure("ready_timeout");
        }, READY_TIMEOUT_MS);
      })
      .catch((_err: unknown) => {
        if (mounted) setEmbedError(true);
      });

    return () => {
      mounted = false;
      clearReadyTimer();
      if (player?.destroy) player.destroy();
      playerRef.current = null;
      setReady(false);
    };
  }, [
    isClient,
    videoId,
    resolveResumeSeekSec,
    assignmentId,
    playerEpoch,
    clearReadyTimer,
    reportEmbedFailure,
  ]);

  const lastToastTimeRef = useRef(0);
  const showRateToast = useCallback(() => {
    const now = Date.now();
    if (now - lastToastTimeRef.current < TOAST_COOLDOWN_MS) return;
    lastToastTimeRef.current = now;
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(RATE_TOAST_MESSAGE);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const clampRate = () => {
      try {
        const p = playerRef.current;
        if (!p) return;
        const rate = p.getPlaybackRate();
        if (typeof rate === "number" && Number.isFinite(rate) && rate > MAX_PLAYBACK_RATE) {
          const capped = resolveCappedPlaybackRate(p);
          lastKnownRateRef.current = capped;
          p.setPlaybackRate(capped);
          showRateToast();
        } else {
          lastKnownRateRef.current = rate;
        }
      } catch {
        // ignore
      }
    };

    const interval = setInterval(clampRate, RATE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ready, showRateToast]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        tabHiddenRef.current = true;
        maxWatchedWhenHiddenRef.current = maxWatchedRef.current;
        try {
          const p = playerRef.current;
          if (p) {
            const endSec = lastPlayingPositionRef.current;
            if (Number.isFinite(endSec)) finalizeSegmentRef.current(endSec);
          }
        } catch {
          // ignore
        }
      } else {
        tabHiddenRef.current = false;
        justBecameVisibleRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !assignmentId) return;
    const flushProgress = (keepalive: boolean) => {
      const token = lastAuthTokenRef.current;
      const p = playerRef.current;
      if (!token || !p) return;
      try {
        const duration = p.getDuration();
        if (!Number.isFinite(duration) || duration <= 0) return;
        const current = p.getCurrentTime();
        if (segmentOpenRef.current && Number.isFinite(current)) {
          finalizeSegmentRef.current(current);
        }
        if (Number.isFinite(current)) lastKnownTimeRef.current = current;
        const lastPos = preventSkipRef.current ? maxWatchedRef.current : current;
        const progressPercent = isCompletedRef.current
          ? Math.max(savedProgressRef.current, 100)
          : computePercent(duration);
        const newCompleted =
          isCompletedRef.current || progressPercent >= COMPLETE_THRESHOLD_PERCENT;
        if (newCompleted) isCompletedRef.current = true;

        const mergedIntervals = mergeIntervals(watchedIntervalsRef.current);
        const useIntervalPath = mergedIntervals.length > 0;

        const body: Record<string, unknown> = {
          assignmentId,
          last_position: lastPos,
          is_completed: newCompleted,
        };

        if (useIntervalPath) {
          body.watched_intervals = mergedIntervals;
          body.duration_sec = duration;
          body.progress_percent = Math.min(100, Math.round(progressPercent * 100) / 100);
        } else {
          body.progress_percent = Math.min(100, Math.round(progressPercent * 100) / 100);
        }

        void fetchProgressWithRetry(
          "/api/progress",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
            keepalive,
          },
          { maxAttempts: 1 }
        ).catch((err) => warnProgressFailure("[progress] keepalive flush failed", err));
      } catch {
        // ignore
      }
    };
    const onBeforeUnload = () => flushProgress(true);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      try {
        const p = playerRef.current;
        if (p) {
          const t = p.getCurrentTime();
          if (Number.isFinite(t)) {
            lastKnownTimeRef.current = t;
            saveWatchSessionPosition(assignmentId, t);
          }
        }
      } catch {
        // ignore
      }
      flushProgress(true);
    };
    const onPageHide = () => {
      try {
        const p = playerRef.current;
        if (p) {
          const current = p.getCurrentTime();
          if (Number.isFinite(current)) {
            finalizeSegmentRef.current(current);
            lastKnownTimeRef.current = current;
            saveWatchSessionPosition(assignmentId, current);
          }
        }
      } catch {
        // ignore
      }
      flushProgress(true);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [assignmentId, computePercent]);

  useEffect(() => {
    if (!ready || !assignmentId) return;

    progressIntervalRef.current = setInterval(() => {
      try {
        const p = playerRef.current;
        if (!p) return;

        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          lastCurrentRef.current = p.getCurrentTime();
          return;
        }

        const state = p.getPlayerState();
        if (state !== 1) return;

        const current = p.getCurrentTime();
        let duration = p.getDuration();
        if (duration <= 0) duration = durationRef.current;
        if (duration > 0) durationRef.current = duration;

        if (!Number.isFinite(current) || current < 0) return;
        if (!Number.isFinite(duration) || duration <= 0) return;

        const prevCurrent = lastCurrentRef.current;
        lastCurrentRef.current = current;
        lastPlayingPositionRef.current = current;
        lastKnownTimeRef.current = current;

        if (justBecameVisibleRef.current) {
          maxWatchedRef.current = Math.min(maxWatchedWhenHiddenRef.current, current);
          lastCurrentRef.current = maxWatchedRef.current;
          lastPlayingPositionRef.current = maxWatchedRef.current;
          justBecameVisibleRef.current = false;
          return;
        }

        const skipLocked = preventSkipRef.current;
        if (skipLocked) {
          const jumpForward = current - prevCurrent > 1.5;
          const aheadOfMax = current > maxWatchedRef.current + SKIP_TOLERANCE_SEC;
          if (jumpForward && aheadOfMax) {
            finalizeSegment(prevCurrent);
            p.seekTo(maxWatchedRef.current, true);
            lastCurrentRef.current = maxWatchedRef.current;
            p.pauseVideo();
            const now = Date.now();
            if (now - skipAlertCooldownRef.current > 2000) {
              skipAlertCooldownRef.current = now;
              alert("영상을 건너뛸 수 없습니다. 시청한 위치로 되돌립니다.");
            }
            return;
          }
        }

        if (detectSeekBreak(prevCurrent, current)) {
          finalizeSegment(prevCurrent);
          openSegment(current);
        } else if (!segmentOpenRef.current) {
          openSegment(prevCurrent);
        }

        if (current > maxWatchedRef.current) {
          maxWatchedRef.current = current;
        }

        const percentValue = computePercent(duration);
        if (!Number.isFinite(percentValue) || percentValue < 0 || percentValue > 100) return;
        savedProgressRef.current = Math.max(savedProgressRef.current, percentValue);
        setProgressPercent(Math.min(100, savedProgressRef.current));

        if (!hasFiredFirstProgressRef.current && percentValue >= FIRST_PROGRESS_THRESHOLD) {
          hasFiredFirstProgressRef.current = true;
          try {
            onFirstProgress?.();
          } catch {
            // ignore
          }
        }

        const lastPos = skipLocked ? maxWatchedRef.current : current;

        if (percentValue >= COMPLETE_THRESHOLD_PERCENT) {
          if (!skipLocked && current > lastSaveVideoPositionRef.current) {
            const segmentDuration = current - lastSaveVideoPositionRef.current;
            if (segmentDuration <= 6) {
              sendWatchSegment(lastSaveVideoPositionRef.current, current);
            }
            lastSaveVideoPositionRef.current = current;
          }
          finalizeSegment(current);
          isCompletedRef.current = true;
          saveProgress(percentValue, true, lastPos);
          lastSavedPercentRef.current = Math.max(lastSavedPercentRef.current, percentValue);
          return;
        }

        const now = Date.now();
        if (now - lastSaveTimeRef.current >= PROGRESS_SAVE_INTERVAL_MS) {
          lastSaveTimeRef.current = now;
          if (!skipLocked && current > lastSaveVideoPositionRef.current) {
            const segmentDuration = current - lastSaveVideoPositionRef.current;
            if (segmentDuration <= 6) {
              sendWatchSegment(lastSaveVideoPositionRef.current, current);
            }
            lastSaveVideoPositionRef.current = current;
          }
          const toSave = Math.min(100, Math.round(percentValue * 100) / 100);
          if (Number.isFinite(toSave) && toSave >= 0 && toSave > lastSavedPercentRef.current) {
            saveProgress(toSave, false, lastPos);
            lastSavedPercentRef.current = toSave;
          }
        }
      } catch {
        // ignore
      }
    }, 500);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [ready, assignmentId, saveProgress, sendWatchSegment, computePercent, detectSeekBreak, finalizeSegment, openSegment, onFirstProgress]);

  if (!isClient) {
    return <div className="aspect-video rounded-xl bg-gray-900" />;
  }

  const overlayDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("overlayDebug") === "1";

  const showFailureOverlay = playbackFailure !== null || embedError;

  return (
    <>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:h-full [&>iframe]:w-full"
        />
        <div
          className={overlayShieldClass(OVERLAY_ZONES.topLeft.className, overlayDebug)}
          title="진도 저장을 위해 이 페이지에서 시청해 주세요."
          aria-hidden
        />
        <div
          className={overlayShieldClass(OVERLAY_ZONES.bottomLeft.className, overlayDebug)}
          style={OVERLAY_ZONES.bottomLeft.size}
          aria-hidden
        />
        <div
          className={overlayShieldClass(OVERLAY_ZONES.bottomRight.className, overlayDebug)}
          style={OVERLAY_ZONES.bottomRight.size}
          aria-hidden
        />
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
        </div>
        {toastMessage && (
          <div
            role="alert"
            className="absolute bottom-4 left-4 right-4 z-10 rounded-lg bg-slate-900/95 px-4 py-3 text-center text-sm font-medium text-white shadow-lg sm:left-1/2 sm:right-auto sm:w-auto sm:min-w-[280px] sm:-translate-x-1/2"
          >
            {toastMessage}
          </div>
        )}
        {showFailureOverlay && (
          <div
            role="alert"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/90 p-5 text-center"
          >
            {embedError ? (
              <>
                <p className="mb-2 text-sm font-medium text-white">영상을 불러오지 못했어요.</p>
                <p className="mb-4 text-xs text-zinc-300">
                  아래 ‘다시 시도’ 또는 ‘영상이 안 나와요’를 눌러 보세요.
                </p>
                {isStandalonePwa && (
                  <p className="mb-4 max-w-sm text-xs text-zinc-400">
                    홈 화면 앱에서 안 되면 크롬 브라우저에서 열어 보세요.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handlePlaybackRetry}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  다시 시도
                </button>
                <button
                  type="button"
                  onClick={handleUserReportPlayback}
                  className="mt-3 rounded-md border border-zinc-500 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  영상이 안 나와요
                </button>
              </>
            ) : (
              (() => {
                const copy = getPlaybackFailureMessage(playbackFailure!);
                return (
                  <>
                    <p className="mb-2 text-sm font-medium text-white">{copy.title}</p>
                    {copy.extra && (
                      <p className="mb-4 text-xs text-zinc-300">{copy.extra}</p>
                    )}
                    {isStandalonePwa && (
                      <p className="mb-4 max-w-sm text-xs text-zinc-400">
                        홈 화면 앱에서 안 되면 크롬 브라우저에서 열어 보세요.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handlePlaybackRetry}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      다시 시도
                    </button>
                    <button
                      type="button"
                      onClick={handleUserReportPlayback}
                      className="mt-3 rounded-md border border-zinc-500 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
                    >
                      영상이 안 나와요
                    </button>
                  </>
                );
              })()
            )}
          </div>
        )}
      </div>
      <div className="watch-player-hint mt-2 flex flex-col items-center gap-2 text-center text-xs text-zinc-500">
        <p>영상이 안 나오면 아래 버튼을 눌러 주세요</p>
        <button
          type="button"
          onClick={handleUserReportPlayback}
          className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          영상이 안 나와요
        </button>
      </div>
    </>
  );
}
