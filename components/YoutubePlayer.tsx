"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const SKIP_TOLERANCE_SEC = 0.5;
const LOCKED_PLAYBACK_RATE = 1;
const COMPLETE_THRESHOLD = 0.95;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
/** 배속 체크 주기: 너무 짧으면 오류·깜빡임 유발 가능 → 1초로 완화 */
const RATE_CHECK_INTERVAL_MS = 1000;
const RATE_TOAST_MESSAGE = "배속 변경은 허용되지 않습니다. 1배속만 사용 가능합니다.";
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

export default function YoutubePlayer({ videoId, assignmentId, initialPosition = 0, preventSkip = true }: Props) {
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
            updated_at: now,
          })
          .eq("id", assignmentId);
      } catch (_: unknown) {
        // ignore
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
            onStateChange: () => {
              if (!mounted || !playerRef.current) return;
              try {
                const p = playerRef.current;
                const r = p.getPlaybackRate();
                if (typeof r !== "number" || !Number.isFinite(r) || r !== LOCKED_PLAYBACK_RATE) {
                  p.setPlaybackRate(LOCKED_PLAYBACK_RATE);
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

  /** 배속 1x 고정: 단일 인터벌로만 체크. 와이드 뷰/가로 모드에서도 레이아웃과 무관하게 계속 동작함. */
  useEffect(() => {
    if (!ready) return;

    const clampRate = () => {
      try {
        const p = playerRef.current;
        if (!p) return;
        const rate = p.getPlaybackRate();
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate !== LOCKED_PLAYBACK_RATE) {
          lastKnownRateRef.current = LOCKED_PLAYBACK_RATE;
          p.setPlaybackRate(LOCKED_PLAYBACK_RATE);
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

  useEffect(() => {
    if (!ready || !assignmentId) return;

    progressIntervalRef.current = setInterval(() => {
      try {
        const p = playerRef.current;
        if (!p) return;

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
        재생이 안 되면{" "}
        <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-red-500 underline">
          YouTube에서 보기
        </a>
        <span className="text-amber-600"> (YouTube에서 보시면 진도가 저장되지 않습니다)</span>
      </p>
    </>
  );
}
