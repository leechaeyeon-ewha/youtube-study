"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import ReactPlayer from "react-player";
import { supabase } from "@/lib/supabase";

const SKIP_TOLERANCE_SEC = 2;
const COMPLETE_THRESHOLD = 0.95;
const PROGRESS_SAVE_INTERVAL_MS = 5000;

interface Props {
  videoId: string;
  assignmentId: string;
}

export default function YoutubePlayer({ videoId, assignmentId }: Props) {
  const playerRef = useRef<any>(null);
  const [isClient, setIsClient] = useState(false);
  const [embedError, setEmbedError] = useState(false);
  const maxWatchedRef = useRef(0);
  const durationRef = useRef(0);
  const lastSavedPercentRef = useRef(0);
  const lastSaveTimeRef = useRef(0);
  const [progressPercent, setProgressPercent] = useState(0);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const saveProgress = useCallback(
    async (percent: number, completed: boolean, playedSeconds: number) => {
      if (!supabase) return;
      const now = new Date().toISOString();
      try {
        await supabase
          .from("assignments")
          .update({
            progress_percent: completed ? 100 : Math.min(100, Math.round(percent * 100) / 100),
            is_completed: completed,
            last_position: playedSeconds,
            last_watched_at: now,
            updated_at: now,
          })
          .eq("id", assignmentId);
      } catch (_) {
        // ignore
      }
    },
    [assignmentId]
  );

  useEffect(() => {
    if (!isClient || !assignmentId) return;

    const interval = setInterval(() => {
      try {
        const el = playerRef.current;
        const rate = typeof el?.playbackRate === "number" ? el.playbackRate : el?.getInternalPlayer?.()?.getPlaybackRate?.();
        if (rate != null && rate > 1.01) {
          if (typeof el?.playbackRate === "number") el.playbackRate = 1;
          else el?.getInternalPlayer?.()?.setPlaybackRate?.(1);
          alert("배속 변경은 허용되지 않습니다. 1배속으로 초기화됩니다.");
        }
      } catch (_) {
        // ignore
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isClient, assignmentId]);

  const handleProgress = useCallback(
    (state: { played: number; playedSeconds: number; loadedSeconds: number; duration: number }) => {
      const current = state.playedSeconds;
      const duration = state.duration || durationRef.current;
      if (duration > 0) durationRef.current = duration;

      if (current > maxWatchedRef.current + SKIP_TOLERANCE_SEC) {
        const target = maxWatchedRef.current;
        const el = playerRef.current;
        if (typeof el?.seekTo === "function") el.seekTo(target, "seconds");
        else if (el && "currentTime" in el) (el as { currentTime: number }).currentTime = target;
        alert("영상을 건너뛸 수 없습니다. 시청한 위치로 되돌립니다.");
        return;
      }

      if (current > maxWatchedRef.current) {
        maxWatchedRef.current = current;
      }

      const percent = duration > 0 ? current / duration : 0;
      setProgressPercent(percent * 100);

      if (percent >= COMPLETE_THRESHOLD) {
        saveProgress(100, true, current);
        lastSavedPercentRef.current = 100;
        return;
      }

      const now = Date.now();
      if (now - lastSaveTimeRef.current >= PROGRESS_SAVE_INTERVAL_MS) {
        const toSave = Math.min(100, Math.round(percent * 100 * 100) / 100);
        if (toSave > lastSavedPercentRef.current) {
          saveProgress(toSave, false, current);
          lastSavedPercentRef.current = toSave;
          lastSaveTimeRef.current = now;
        }
      }
    },
    [saveProgress]
  );

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const youtubeConfig = {
    origin: typeof window !== "undefined" ? window.location.origin : "",
    enablejsapi: 1,
    rel: 0,
    iv_load_policy: 3,
    playsinline: 1,
  };

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

  const Player = ReactPlayer as any;

  return (
    <>
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl">
      <Player
        key={videoId}
        ref={playerRef}
        url={youtubeUrl}
        width="100%"
        height="100%"
        controls
        playsinline
        onProgress={handleProgress}
        onDuration={(d: number) => {
          durationRef.current = d;
        }}
        onError={() => setEmbedError(true)}
        config={{ youtube: youtubeConfig }}
      />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>
    </div>
    <p className="mt-2 text-center text-xs text-zinc-500">
      재생이 안 되면{" "}
      <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-red-500 underline">
        YouTube에서 보기
      </a>
      <span className="text-amber-600"> (YouTube에서 보시면 진도가 저장되지 않습니다)</span>
    </p>
    </>
  );
}
