"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { ASSIGNMENT_SELECT_WATCH, ASSIGNMENT_SELECT_WATCH_FALLBACK } from "@/lib/assignments";
import { normalizeIntervals, type WatchedInterval } from "@/lib/watchIntervals";
import { invalidateStudentAssignmentsCache } from "@/lib/studentAssignmentsCache";
import { resolveWatchStartPosition } from "@/lib/watchSessionRestore";
import YoutubePlayer from "@/components/YoutubePlayer";
import LoadingSpinner from "@/components/LoadingSpinner";

interface Video {
  id: string;
  title: string;
  video_id: string;
}

interface AssignmentRow {
  id: string;
  is_completed: boolean;
  progress_percent?: number;
  last_position?: number;
  prevent_skip?: boolean;
  watched_intervals?: unknown;
  videos: Video | null;
}

interface PlayContext {
  assignmentId: string;
  startPosition: number;
  watchedIntervals: WatchedInterval[];
  progressPercent: number;
  preventSkip: boolean;
}

/** URL의 assignmentId가 유효한 문자열인지 검사 후 반환. 유효하지 않으면 null */
function parseAssignmentId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (s.length === 0) return null;
  return s;
}

function startedAtDebug(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.log(...args);
  }
}

function startedAtDebugWarn(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.warn(...args);
  }
}

function startedAtDebugError(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.error(...args);
  }
}

async function fetchAssignmentForWatch(
  id: string,
  userId: string
): Promise<{ row: AssignmentRow | null; error: string | null }> {
  if (!supabase) {
    return { row: null, error: "Supabase가 설정되지 않았습니다." };
  }

  const { data: firstData, error: firstError } = await supabase
    .from("assignments")
    .select(ASSIGNMENT_SELECT_WATCH)
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (
    firstError &&
    (firstError.message?.includes("watched_intervals") ||
      firstError.message?.includes("does not exist"))
  ) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("assignments")
      .select(ASSIGNMENT_SELECT_WATCH_FALLBACK)
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (fallbackError || !fallbackData) {
      return { row: null, error: fallbackError?.message ?? "과제를 찾을 수 없습니다." };
    }
    return { row: fallbackData as AssignmentRow, error: null };
  }

  if (firstError || !firstData) {
    return { row: null, error: firstError?.message ?? "과제를 찾을 수 없습니다." };
  }
  return { row: firstData as AssignmentRow, error: null };
}

export default function WatchPage() {
  const { accessToken, userId } = useAuth();
  const params = useParams();
  const assignmentId = parseAssignmentId(params?.assignmentId);

  const [mounted, setMounted] = useState(false);
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [playContext, setPlayContext] = useState<PlayContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedAtToast, setStartedAtToast] = useState<string | null>(null);

  const recordedAssignmentIdsRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDoneRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const handleRecordStartedAt = useCallback(async () => {
    const id = assignmentId as string | null;

    startedAtDebug("[started_at] 1. 재생 감지됨 (started_at 기록 트리거)");
    startedAtDebug("[started_at] 2. assignmentId 유효 여부:", !!id, "값:", id ?? "(null)");

    if (!id || !supabase) {
      startedAtDebugWarn("[started_at] 중단: assignmentId 없음 또는 supabase 없음");
      return;
    }
    if (recordedAssignmentIdsRef.current.has(id)) {
      startedAtDebug("[started_at] 이미 이 배정에 대해 기록 요청함, 스킵");
      return;
    }
    recordedAssignmentIdsRef.current.add(id);

    startedAtDebug("[started_at] 3. accessToken 확인 중...");
    if (!accessToken) {
      startedAtDebugWarn("[started_at] 중단: accessToken 없음");
      setStartedAtToast("로그인 세션이 없습니다.");
      recordedAssignmentIdsRef.current.delete(id);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setStartedAtToast(null), 5000);
      return;
    }
    startedAtDebug("[started_at] 4. token 있음:", !!accessToken);

    startedAtDebug("[started_at] 5. DB 업데이트 시도 중... (POST /api/watch-start)");
    startedAtDebug("[started_at] 6. 배정(assignment) 행 존재: 시청 페이지 진입 시 이미 조회됨 → 현재 페이지면 행 존재함");

    try {
      const res = await fetch("/api/watch-start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ assignmentId: id as string }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        alreadyRecorded?: boolean;
      };

      if (!res.ok) {
        startedAtDebugError("[started_at] API 응답 실패:", res.status, data);
        const errMsg = data.error ?? "시작 시간 기록에 실패했습니다.";
        setStartedAtToast(errMsg);
        recordedAssignmentIdsRef.current.delete(id);
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = setTimeout(() => setStartedAtToast(null), 5000);
        return;
      }

      startedAtDebug("[started_at] 7. 성공:", data.alreadyRecorded ? "이미 기록됨" : "새로 기록됨");
    } catch (e) {
      startedAtDebugError("[started_at] fetch 예외:", e);
      setStartedAtToast("시작 시간 기록 중 오류가 발생했습니다.");
      recordedAssignmentIdsRef.current.delete(id);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setStartedAtToast(null), 5000);
    }
  }, [assignmentId, accessToken]);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      invalidateStudentAssignmentsCache();
    };
  }, []);

  useEffect(() => {
    initialLoadDoneRef.current = false;
    setPlayContext(null);
    setAssignment(null);
    setLoading(true);
    setError(null);
  }, [assignmentId]);

  useEffect(() => {
    if (!assignmentId) {
      setError("잘못된 경로입니다.");
      setLoading(false);
      return;
    }
    if (!supabase) {
      setError("Supabase가 설정되지 않았습니다.");
      setLoading(false);
      return;
    }
    if (!userId) return;

    const id = assignmentId as string;
    let cancelled = false;

    async function load() {
      const { row, error: fetchError } = await fetchAssignmentForWatch(id, userId!);
      if (cancelled) return;

      if (fetchError || !row) {
        setError(fetchError ?? "과제를 찾을 수 없습니다.");
        setLoading(false);
        initialLoadDoneRef.current = false;
        return;
      }

      setAssignment(row);

      const startPosition = resolveWatchStartPosition(
        id,
        typeof row.last_position === "number" ? row.last_position : 0
      );
      setPlayContext({
        assignmentId: id,
        startPosition,
        watchedIntervals: normalizeIntervals(row.watched_intervals),
        progressPercent: row.progress_percent ?? 0,
        preventSkip: row.prevent_skip !== false,
      });
      setLoading(false);
      initialLoadDoneRef.current = true;

      const needNormalize =
        row.progress_percent == null ||
        row.last_position == null ||
        row.is_completed == null;

      if (needNormalize) {
        const token = accessTokenRef.current;
        if (token) {
          fetch("/api/watch-ensure-progress", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ assignmentId: id }),
          }).catch(() => {});
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, userId]);

  useEffect(() => {
    if (!assignmentId || !userId || !accessToken) return;
    if (!initialLoadDoneRef.current) return;

    const id = assignmentId as string;
    let cancelled = false;

    async function refreshInBackground() {
      const { row, error: fetchError } = await fetchAssignmentForWatch(id, userId!);
      if (cancelled) return;
      if (fetchError || !row) return;

      setAssignment(row);

      const needNormalize =
        row.progress_percent == null ||
        row.last_position == null ||
        row.is_completed == null;

      if (needNormalize) {
        fetch("/api/watch-ensure-progress", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ assignmentId: id }),
        }).catch(() => {});
      }
    }

    refreshInBackground();
    return () => {
      cancelled = true;
    };
  }, [accessToken, assignmentId, userId]);

  if (!mounted) return null;

  if (loading || !playContext || !assignment?.videos) {
    if (error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-zinc-950">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <Link href="/student" className="mt-4 text-blue-600 hover:underline dark:text-blue-400">
            목록으로 돌아가기
          </Link>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-zinc-950">
        <LoadingSpinner />
        <p className="mt-4 text-sm text-zinc-500">불러오는 중...</p>
      </div>
    );
  }

  const video = assignment.videos;

  return (
    <div className="watch-page-landscape flex min-h-[100dvh] flex-col bg-gray-50 py-8 px-4 dark:bg-zinc-950">
      <header className="watch-header mb-6 w-full max-w-4xl mx-auto">
        <Link
          href="/student"
          className="inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400 mb-4"
        >
          ← 목록으로
        </Link>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          {video.title}
        </h1>
      </header>

      <main className="watch-main w-full max-w-4xl mx-auto overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="watch-video-inner p-4 sm:p-6">
          <div className="watch-video-wrap w-full">
            <YoutubePlayer
              videoId={video.video_id}
              assignmentId={playContext.assignmentId}
              initialPosition={playContext.startPosition}
              initialWatchedIntervals={playContext.watchedIntervals}
              initialProgressPercent={playContext.progressPercent}
              preventSkip={playContext.preventSkip}
              onFirstProgress={handleRecordStartedAt}
            />
          </div>
        </div>
        <div className="watch-footer border-t border-gray-100 px-6 py-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {playContext.preventSkip
              ? `저장된 진도: ${(assignment.progress_percent ?? 0).toFixed(1)}% · 스킵 방지가 켜져 있어 앞으로 건너뛸 수 없습니다.`
              : `저장된 진도: ${(assignment.progress_percent ?? 0).toFixed(1)}% · 시청한 구간만 진도에 반영됩니다.`}
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            재생 배속은 1.25배속까지만 지원됩니다. 가로 모드로 보시면 와이드 뷰가 적용됩니다.
          </p>
        </div>
      </main>

      <Link
        href="/student"
        className="watch-back-float fixed left-3 top-3 z-20 rounded-full bg-black/60 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="목록으로"
      >
        ← 목록
      </Link>

      {startedAtToast && (
        <div
          className="fixed bottom-6 left-4 right-4 z-30 rounded-lg bg-red-600 px-4 py-3 text-center text-sm font-medium text-white shadow-lg sm:left-1/2 sm:right-auto sm:w-auto sm:max-w-md sm:-translate-x-1/2"
          role="alert"
        >
          {startedAtToast}
        </div>
      )}
    </div>
  );
}
