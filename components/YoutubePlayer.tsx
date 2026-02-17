"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const SKIP_TOLERANCE_SEC = 0.5;
const MAX_PLAYBACK_RATE = 1.4;
const COMPLETE_THRESHOLD = 0.95;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
/** 배속 체크 주기: 너무 짧으면 오류·깜빡임 유발 가능 → 1초로 완화 */
const RATE_CHECK_INTERVAL_MS = 1000;
const RATE_TOAST_MESSAGE = "배속은 1.4배속까지만 사용 가능합니다.";
const TOAST_DURATION_MS = 2500;
const TOAST_COOLDOWN_MS = 8000;

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
  /** true: 건너뛰기 방지(기본), false: 건너뛰기 허용 */
  preventSkip?: boolean;
  /** 영상이 실제로 재생을 시작한 시점(최초 재생) 콜백 */
  onFirstWatchStart?: () => void;
}

function loadYoutubeAPI(): Promise<NonNullable<Window["YT"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) {
      const check = () => (window.YT?.Player ? resolve(window.YT) : setTimeout(check, 50));
      check();
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);

    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) resolve(window.YT);
      else reject(new Error("YT not loaded"));
    };

    tag.onerror = () => reject(new Error("Failed to load YouTube API"));
  });
}

export default function YoutubePlayer({ videoId, assignmentId, initialPosition = 0, preventSkip = true, onFirstWatchStart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [ready, setReady] = useState(false);
  const [embedError, setEmbedError] = useState(false);
  const maxWatchedRef = useRef(initialPosition);
  const lastCurrentRef = useRef(initialPosition);
  const durationRef = useRef(0);
  const lastSavedPercentRef = useRef(0);
  const lastSaveTimeRef = useRef(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skipAlertCooldownRef = useRef(0);
  const lastKnownRateRef = useRef<number>(1);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 영상 종료 시 추천 영상 클릭 방지용 오버레이 표시 (YT.PlayerState.ENDED === 0) */
  const [showEndedOverlay, setShowEndedOverlay] = useState(false);
  /** 다른 탭으로 이동한 동안 진도 미적용: 탭이 hidden일 때 true */
  const tabHiddenRef = useRef(false);
  /** 탭이 hidden이 되었을 때의 maxWatched(진도로 인정한 최대 시청 위치) — 복귀 시 배경 재생분 반영 안 함 */
  const maxWatchedWhenHiddenRef = useRef(initialPosition);
  /** 탭이 방금 visible로 바뀐 직후 한 번만 배경 재생분을 제외하고 보정 */
  const justBecameVisibleRef = useRef(false);
  /** 영상이 실제로 한 번이라도 재생을 시작했는지 여부 (최초 재생 시 onFirstWatchStart 호출용) */
  const hasFiredFirstWatchStartRef = useRef(false);

  useEffect(() => {
    maxWatchedRef.current = initialPosition;
    lastCurrentRef.current = initialPosition;
  }, [initialPosition]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const saveProgress = useCallback(
    async (percent: number, completed: boolean, playedSeconds: number) => {
      if (!supabase || !assignmentId?.trim()) return;
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
      if (!Number.isFinite(playedSeconds) || playedSeconds < 0) return;
      if (percent === 0 && playedSeconds === 0 && !completed) return;
      const now = new Date().toISOString();
      const progressPercent = completed ? 100 : Math.min(100, Math.round(percent * 100) / 100);
      const lastPosition = playedSeconds;
      if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) return;
      if (!Number.isFinite(lastPosition) || lastPosition < 0) return;
      try {
        await supabase
          .from("assignments")
          .update({
            progress_percent: progressPercent,
            is_completed: completed,
            last_position: lastPosition,
            last_watched_at: now,
          })
          .eq("id", assignmentId);
      } catch (_: unknown) {
        // ignore (updated_at 컬럼 없을 수 있음)
      }
    },
    [assignmentId]
  );

  useEffect(() => {
    if (!isClient || !containerRef.current || !videoId) return;

    let mounted = true;
    let player: YTPlayer | null = null;

    loadYoutubeAPI()
      .then((YT) => {
        if (!mounted || !containerRef.current) return;

        const origin = window.location.origin;
        player = new YT.Player(containerRef.current, {
          height: "100%",
          width: "100%",
          videoId,
          playerVars: {
            origin,
            enablejsapi: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            fs: 0, /* 전체 화면 버튼 비활성화 (와이드 뷰로 대체) */
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
              /* ENDED(0)일 때만 추천 영상 클릭 차단 오버레이 표시, 재생/일시정지 시 제거 */
              if (e.data === 0) setShowEndedOverlay(true);
              else setShowEndedOverlay(false);
              if (!playerRef.current) return;
              try {
                const p = playerRef.current;
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
      setShowEndedOverlay(false);
    };
  }, [isClient, videoId, initialPosition]);

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

  /** 배속 1.4x 초과 시 막기: 단일 인터벌로 체크. 와이드 뷰/가로 모드에서도 레이아웃과 무관하게 동작함. */
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
      } catch (_: unknown) {
        // ignore
      }
    };

    const interval = setInterval(clampRate, RATE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ready, showRateToast]);

  /** 다른 탭일 때 진도 카운트/저장 중단, 복귀 시 배경 재생분 미적용 */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        tabHiddenRef.current = true;
        maxWatchedWhenHiddenRef.current = maxWatchedRef.current;
      } else {
        tabHiddenRef.current = false;
        justBecameVisibleRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

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

        // 최초로 실제 재생이 시작된 시점(진도가 0보다 커지는 첫 순간)에 콜백 한 번만 호출
        if (!hasFiredFirstWatchStartRef.current) {
          const hasRealProgress = current > 0.1 || prevCurrent === 0 && current > 0;
          if (hasRealProgress) {
            hasFiredFirstWatchStartRef.current = true;
            try {
              onFirstWatchStart?.();
            } catch {
              // 콜백 예외는 플레이어 동작에 영향 주지 않음
            }
          }
        }

        if (justBecameVisibleRef.current) {
          maxWatchedRef.current = Math.min(maxWatchedWhenHiddenRef.current, current);
          lastCurrentRef.current = maxWatchedRef.current;
          justBecameVisibleRef.current = false;
          return;
        }

        if (preventSkip) {
          const jumpForward = current - prevCurrent > 1.5;
          const aheadOfMax = current > maxWatchedRef.current + SKIP_TOLERANCE_SEC;
          if (jumpForward && aheadOfMax) {
            p.seekTo(maxWatchedRef.current, true);
            lastCurrentRef.current = maxWatchedRef.current;
            const now = Date.now();
            if (now - skipAlertCooldownRef.current > 2000) {
              skipAlertCooldownRef.current = now;
              alert("영상을 건너뛸 수 없습니다. 시청한 위치로 되돌립니다.");
            }
            return;
          }
        }

        if (current > maxWatchedRef.current) {
          maxWatchedRef.current = current;
        }

        const percent = duration > 0 ? current / duration : 0;
        if (!Number.isFinite(percent) || percent < 0 || percent > 1) return;
        setProgressPercent(percent * 100);

        if (percent >= COMPLETE_THRESHOLD) {
          saveProgress(100, true, current);
          lastSavedPercentRef.current = 100;
          return;
        }

        const now = Date.now();
        if (now - lastSaveTimeRef.current >= PROGRESS_SAVE_INTERVAL_MS) {
          const toSave = Math.min(100, Math.round(percent * 100 * 100) / 100);
          if (Number.isFinite(toSave) && toSave >= 0 && toSave > lastSavedPercentRef.current) {
            saveProgress(toSave, false, current);
            lastSavedPercentRef.current = toSave;
            lastSaveTimeRef.current = now;
          }
        }
      } catch (_err: unknown) {
        // ignore
      }
    }, 500);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [ready, assignmentId, saveProgress, preventSkip]);

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
        {/* 유튜브 로고 클릭 시 유튜브로 이동하는 것 방지: 오른쪽 하단 클릭 차단 */}
        <div
          className="absolute bottom-0 right-0 z-10 h-14 w-32 cursor-default"
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
        {/* 영상 종료 시 추천 영상 클릭 방지: 전체 플레이어를 덮어 클릭 불가 */}
        {showEndedOverlay && (
          <div
            className="absolute inset-0 z-20 flex cursor-default items-center justify-center bg-black/60 backdrop-blur-[1px]"
            title="영상 시청이 완료되었습니다"
          >
            <p className="rounded-lg bg-slate-900/90 px-4 py-2 text-sm font-medium text-white">
              영상 시청이 완료되었습니다
            </p>
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
