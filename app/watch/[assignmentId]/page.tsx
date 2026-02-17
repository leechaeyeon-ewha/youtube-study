"use client";

import { useEffect, useState, useRef } from "react";
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

export default function WatchPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params?.assignmentId as string | undefined;

  const [mounted, setMounted] = useState(false);
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 이미 학습 시작 기록을 보낸 assignmentId 집합 (과제별 1회, 다른 영상으로 이동 시에도 기록) */
  const recordedAssignmentIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!assignmentId) {
      setLoading(false);
      setError("잘못된 경로입니다.");
      return;
    }
    if (!supabase) {
      setError("Supabase가 설정되지 않았습니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      const [{ data: { user } }, { data: { session } }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
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
        .eq("id", assignmentId)
        .eq("user_id", user.id)
        .single();

      if (cancelled) return;
      if (fetchError || !data) {
        setError(fetchError?.message ?? "과제를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      setAssignment(data as AssignmentRow);

      const token = session?.access_token;
      const alreadyRecorded = recordedAssignmentIdsRef.current.has(assignmentId);
      if (token && !alreadyRecorded) {
        recordedAssignmentIdsRef.current.add(assignmentId);
        try {
          const res = await fetch("/api/watch-start", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ assignmentId }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (err?.error?.includes("watch_starts") || err?.error?.includes("테이블")) {
              console.warn("[watch-start]", err.error);
            }
          }
        } catch {
          recordedAssignmentIdsRef.current.delete(assignmentId);
        }
      }

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
              assignmentId={assignment.id}
              initialPosition={typeof assignment.last_position === "number" ? assignment.last_position : 0}
              preventSkip={assignment.prevent_skip !== false}
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
