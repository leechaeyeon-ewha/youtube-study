"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import {
  fetchStudentAssignmentsList,
  STUDENT_ASSIGNMENTS_CACHE_TTL_MS,
} from "@/lib/studentAssignmentsCache";
import { getThumbnailUrl } from "@/lib/youtube";
import LoadingSpinner from "@/components/LoadingSpinner";
import ListSortDropdown from "@/components/ListSortDropdown";
import { sortArray, type ListSortOption } from "@/lib/listSort";

const STANDALONE_PLAYLIST_ID = "standalone";
const STANDALONE_PLAYLIST_TITLE = "개별 보충 영상";

/** window focus 재조회 최소 간격 */
const ASSIGNMENTS_FOCUS_REFETCH_MS = STUDENT_ASSIGNMENTS_CACHE_TTL_MS;

interface AssignmentRow {
  id: string;
  is_completed: boolean;
  progress_percent: number;
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
  /** 관리자/강사 배정일 */
  created_at?: string | null;
  videos: {
    id: string;
    title: string;
    video_id: string;
    course_id?: string | null;
    courses?: { id: string; title: string } | null;
  } | null;
}

export default function StudentPlaylistPage() {
  const { userId } = useAuth();
  const params = useParams();
  const playlistId = (params?.id as string) ?? "";
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoListSort, setVideoListSort] = useState<ListSortOption>("date-desc");
  const lastAssignmentsFetchAtRef = useRef(0);

  const sortedAssignments = useMemo(
    () =>
      sortArray(
        assignments,
        videoListSort,
        (a) => a.videos?.title ?? "",
        (a) => a.created_at
      ),
    [assignments, videoListSort]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!playlistId) {
      setLoading(false);
      setError("잘못된 경로입니다.");
      return;
    }
    if (!supabase) {
      setError("Supabase가 설정되지 않았습니다.");
      setLoading(false);
      return;
    }

    if (!userId) return;
    const uid = userId;

    let cancelled = false;
    async function load(fromFocus = false) {
      if (
        fromFocus &&
        lastAssignmentsFetchAtRef.current > 0 &&
        Date.now() - lastAssignmentsFetchAtRef.current < ASSIGNMENTS_FOCUS_REFETCH_MS
      ) {
        return;
      }

      const { data, error: fetchError } = await fetchStudentAssignmentsList(
        supabase!,
        uid,
        { force: fromFocus }
      );

      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      if (data == null) {
        setError("데이터를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      const list = data as AssignmentRow[];
      // 관리자 삭제/숨김(is_visible=false) 처리한 영상은 즉시 제외
      const visible = list.filter((a) => a.is_visible !== false);

      const isStandalone = playlistId === STANDALONE_PLAYLIST_ID;
      const filtered = visible.filter((a) => {
        const v = a.videos;
        if (!v) return false;
        const cid = v.course_id ?? null;
        if (isStandalone) return cid === null;
        return cid === playlistId;
      });

      if (filtered.length > 0) {
        const first = filtered[0].videos;
        if (first?.courses && !Array.isArray(first.courses)) {
          setTitle((first.courses as { title: string }).title);
        } else if (isStandalone) {
          setTitle(STANDALONE_PLAYLIST_TITLE);
        } else {
          setTitle("재생목록");
        }
      } else {
        setTitle(isStandalone ? STANDALONE_PLAYLIST_TITLE : "재생목록");
      }

      setAssignments(filtered);
      lastAssignmentsFetchAtRef.current = Date.now();
      setLoading(false);
    }

    load(false);
    const onFocus = () => { load(true); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [playlistId, userId]);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <LoadingSpinner />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-zinc-950">
        <div className="mx-auto max-w-4xl">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <Link href="/student" className="mt-4 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
            ← 학생 홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <Link
            href="/student"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <span aria-hidden>←</span> 재생목록으로 돌아가기
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            영상 {assignments.length}개 · 클릭하면 시청 페이지로 이동합니다.
          </p>
          {assignments.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">재생목록 내 영상</span>
              <ListSortDropdown
                id="student-playlist-video-sort"
                value={videoListSort}
                onChange={setVideoListSort}
              />
            </div>
          )}
        </header>

        {assignments.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-slate-500 dark:text-slate-400">
              이 재생목록에 할당된 영상이 없습니다.
            </p>
            <Link href="/student" className="mt-4 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
              학생 홈으로
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {sortedAssignments.map((a, index) => {
              const video = a.videos;
              if (!video) return null;
              return (
                <li key={a.id}>
                  <Link
                    href={`/watch/${a.id}`}
                    className="flex items-stretch gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-indigo-200 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-800 sm:gap-3 sm:px-4 sm:py-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full bg-slate-100 text-xs font-medium text-slate-600 dark:bg-zinc-700 dark:text-slate-300">
                      {index + 1}
                    </span>
                    <div className="relative h-10 w-16 shrink-0 self-center overflow-hidden rounded-md bg-slate-200 dark:bg-zinc-800 sm:h-11 sm:w-[72px]">
                      <img
                        src={getThumbnailUrl(video.video_id)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1 self-center py-0.5">
                      <h2 className="break-words font-medium text-slate-900 dark:text-white [overflow-wrap:anywhere]">
                        {video.title}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {a.is_weekly_assignment && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            주간 과제
                          </span>
                        )}
                        <span className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
                          {a.is_completed ? "시청 완료" : `진도 ${(a.progress_percent ?? 0).toFixed(0)}%`}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end justify-center self-stretch pl-1">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium sm:px-2.5 sm:text-xs ${
                          a.is_completed
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        }`}
                      >
                        {a.is_completed ? "완료" : "미완료"}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
