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
        const internal = playerRef.current?.getInternalPlayer?.();
        if (internal && typeof internal.getPlaybackRate === "function") {
          const rate = internal.getPlaybackRate();
          if (rate > 1.01) {
            internal.setPlaybackRate(1);
            alert("배속 변경은 허용되지 않습니다. 1배속으로 초기화됩니다.");
          }
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
        maxWatchedRef.current = maxWatchedRef.current;
        playerRef.current?.seekTo(maxWatchedRef.current, "seconds");
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

  if (!isClient) {
    return <div className="aspect-video rounded-xl bg-gray-900" />;
  }

  const Player = ReactPlayer as any;

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl">
      <Player
        ref={playerRef}
        url={`https://www.youtube.com/watch?v=${videoId}`}
        width="100%"
        height="100%"
        controls
        onProgress={handleProgress}
        onDuration={(d: number) => {
          durationRef.current = d;
        }}
        config={{
          youtube: {
            playerVars: {
              origin: typeof window !== "undefined" ? window.location.origin : "",
            },
          },
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>
    </div>
  );
}
