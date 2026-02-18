"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
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
  videos: Video | null;
}

/** URL의 assignmentId가 유효한 문자열인지 검사 후 반환. 유효하지 않으면 null */
function parseAssignmentId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (s.length === 0) return null;
  return s;
}

export default function WatchPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = parseAssignmentId(params?.assignmentId);

  const [mounted, setMounted] = useState(false);
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 이미 최초 시청 시작 기록을 요청한 assignment id 집합 (중복·부하 방지) */
  const recordedAssignmentIdsRef = useRef<Set<string>>(new Set());

  /** 진도 1% 이상이 되었을 때 한 번만 호출: assignments.started_at 조건부 업데이트 */
  const handleRecordStartedAt = useCallback(async () => {
    const id = assignmentId as string | null;
    if (!id) return;
    if (recordedAssignmentIdsRef.current.has(id)) return;
    recordedAssignmentIdsRef.current.add(id);

    try {
      const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      const res = await fetch("/api/watch-start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ assignmentId: id }),
      });
      if (!res.ok) {
        recordedAssignmentIdsRef.current.delete(id);
      }
    } catch {
      recordedAssignmentIdsRef.current.delete(id);
    }
  }, [assignmentId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!assignmentId) {
      console.error("[watch] assignmentId가 없거나 유효하지 않습니다.", params?.assignmentId);
      setLoading(false);
      setError("잘못된 경로입니다.");
      return;
    }
    const id: string = assignmentId;
    if (!supabase) {
      setError("Supabase가 설정되지 않았습니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      const [{ data: { user } }] = await Promise.all([
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      if (!user) {
        setLoading(false);
        router.replace("/login");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("assignments")
        .select("id, is_completed, progress_percent, last_position, prevent_skip, videos(id, title, video_id)")
        .eq("id", id as string)
        .eq("user_id", user.id)
        .single();

      if (cancelled) return;
      if (fetchError || !data) {
        setError(fetchError?.message ?? "과제를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      setAssignment(data as AssignmentRow);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [assignmentId]);

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-zinc-950">
        <LoadingSpinner />
        <p className="mt-4 text-sm text-zinc-500">불러오는 중...</p>
      </div>
    );
  }

  if (error || !assignment?.videos) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-zinc-950">
        <p className="text-red-600 dark:text-red-400">{error ?? "영상 정보가 없습니다."}</p>
        <Link href="/student" className="mt-4 text-blue-600 hover:underline dark:text-blue-400">
          목록으로 돌아가기
        </Link>
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
              assignmentId={assignment.id as string}
              initialPosition={typeof assignment.last_position === "number" ? assignment.last_position : 0}
              preventSkip={assignment.prevent_skip !== false}
              onFirstProgress={handleRecordStartedAt}
            />
          </div>
        </div>
        <div className="watch-footer border-t border-gray-100 px-6 py-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {assignment.is_completed
              ? "완료된 영상입니다."
              : `저장된 진도: ${(assignment.progress_percent ?? 0).toFixed(1)}% · 영상을 끝까지 시청하면 완료 처리됩니다.`}
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            재생 배속은 1.4배속까지만 지원됩니다. 가로 모드로 보시면 와이드 뷰가 적용됩니다.
          </p>
        </div>
      </main>

      {/* 가로 모드 시 네비게이션: 시네마틱 뷰에서도 목록으로 돌아가기 (CSS에서 landscape일 때만 표시) */}
      <Link
        href="/student"
        className="watch-back-float fixed left-3 top-3 z-20 rounded-full bg-black/60 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="목록으로"
      >
        ← 목록
      </Link>
    </div>
  );
}
