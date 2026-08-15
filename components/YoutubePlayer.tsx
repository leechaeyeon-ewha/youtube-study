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

const SKIP_TOLERANCE_SEC = 0.5;
const MAX_PLAYBACK_RATE = 1.4;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
/** 배속 체크 주기: 너무 짧으면 오류·깜빡임 유발 가능 → 1초로 완화 */
const RATE_CHECK_INTERVAL_MS = 1000;
const RATE_TOAST_MESSAGE = "배속은 1.4배속까지만 사용 가능합니다.";
const TOAST_DURATION_MS = 2500;
const TOAST_COOLDOWN_MS = 8000;

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
          playerVars: Record<string, string | number>;
          events: { onReady?: (e: { target: YTPlayer }) => void; onStateChange?: (e: { data: number }) => void };
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
  destroy: () => void;
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
        let res = await fetch("/api/progress", {
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
          res = await fetch("/api/progress", {
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
        }
      } catch {
        // ignore
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
  }, []);

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

    loadYoutubeAPI()
      .then((YT) => {
        if (!mounted || !containerRef.current) return;

        const pageOrigin = getPageOrigin();
        const pageHref = window.location.href;
        player = new YT.Player(containerRef.current, {
          height: "100%",
          width: "100%",
          videoId,
          playerVars: {
            origin: pageOrigin,
            widget_referrer: pageHref,
            enablejsapi: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            fs: 0,
            start: Math.floor(initialPosition),
          },
          events: {
            onReady: (event: { target: YTPlayer }) => {
              if (!mounted) return;
              playerRef.current = event.target;
              const p = event.target;
              if (initialPosition > 0) p.seekTo(initialPosition, true);
              try {
                p.setPlaybackRate(1);
              } catch {
                // ignore
              }
              setReady(true);
            },
            onStateChange: (e: { data: number }) => {
              if (!mounted) return;
              if (!playerRef.current) return;
              try {
                const p = playerRef.current;
                if (e.data !== 1) {
                  const endSec = lastPlayingPositionRef.current;
                  if (Number.isFinite(endSec)) finalizeSegment(endSec);
                }

                if (e.data === 0) {
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
                  p.setPlaybackRate(MAX_PLAYBACK_RATE);
                }
              } catch {
                // ignore
              }
            },
          },
        }) as unknown as YTPlayer;
      })
      .catch((_err: unknown) => {
        if (mounted) setEmbedError(true);
      });

    return () => {
      mounted = false;
      if (player?.destroy) player.destroy();
      playerRef.current = null;
      setReady(false);
    };
  }, [isClient, videoId, initialPosition, finalizeSegment]);

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
          lastKnownRateRef.current = MAX_PLAYBACK_RATE;
          p.setPlaybackRate(MAX_PLAYBACK_RATE);
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
            if (Number.isFinite(endSec)) finalizeSegment(endSec);
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
  }, [finalizeSegment]);

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
        if (segmentOpenRef.current && Number.isFinite(current)) finalizeSegment(current);
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
          last_watched_at: new Date().toISOString(),
          is_completed: newCompleted,
        };

        if (useIntervalPath) {
          body.watched_intervals = mergedIntervals;
          body.duration_sec = duration;
          body.progress_percent = Math.min(100, Math.round(progressPercent * 100) / 100);
        } else {
          body.progress_percent = Math.min(100, Math.round(progressPercent * 100) / 100);
        }

        fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          keepalive,
        });
      } catch {
        // ignore
      }
    };
    const onBeforeUnload = () => flushProgress(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress(false);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [assignmentId, computePercent, finalizeSegment]);

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

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  if (!isClient) {
    return <div className="aspect-video rounded-xl bg-gray-900" />;
  }

  if (embedError) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-xl bg-zinc-900 p-6 text-center">
        <p className="mb-4 text-sm text-zinc-300">
          이 영상은 이 페이지에서 재생되지 않습니다. (임베드 비허용 또는 제한된 영상일 수 있습니다.)
        </p>
        <p className="mb-4 text-xs text-amber-400">
          YouTube에서 보시면 진도가 저장되지 않습니다. 가능하면 이 페이지에서 시청해 주세요.
        </p>
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700"
        >
          YouTube에서 보기
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:h-full [&>iframe]:w-full"
        />
        <div
          className="absolute left-0 right-0 top-0 z-10 h-12 cursor-default"
          title="진도 저장을 위해 이 페이지에서 시청해 주세요."
          aria-hidden
        />
        <div
          className="absolute bottom-0 right-0 z-10 h-20 w-24 cursor-default"
          title="진도 저장을 위해 이 페이지에서 시청해 주세요."
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
      </div>
      <p className="watch-player-hint mt-2 text-center text-xs text-zinc-500">
        재생이 안 되면 이 페이지에서 시청해 주세요.
        <span className="text-amber-600"> (YouTube에서 보시면 진도가 저장되지 않습니다)</span>
      </p>
    </>
  );
}
