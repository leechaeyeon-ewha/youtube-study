"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getThumbnailUrl } from "@/lib/youtube";

const STANDALONE_PLAYLIST_ID = "standalone";
const STANDALONE_PLAYLIST_TITLE = "개별 보충 영상";

interface AssignmentRow {
  id: string;
  is_completed: boolean;
  progress_percent: number;
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
  videos: {
    id: string;
    title: string;
    video_id: string;
    course_id?: string | null;
    courses?: { id: string; title: string } | null;
  } | null;
}

export default function StudentPlaylistPage() {
  const params = useParams();
  const router = useRouter();
  const playlistId = (params?.id as string) ?? "";
  const [title, setTitle] = useState<string>("");
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("assignments")
        .select("id, is_completed, progress_percent, is_visible, is_weekly_assignment, videos(id, title, video_id, course_id, courses(id, title))")
        .eq("user_id", user.id);

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as AssignmentRow[];
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
      setLoading(false);
    }

    load();
  }, [playlistId, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
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
            {assignments.map((a, index) => {
              const video = a.videos;
              if (!video) return null;
              return (
                <li key={a.id}>
                  <Link
                    href={`/watch/${a.id}`}
                    className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-indigo-200 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-800"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600 dark:bg-zinc-700 dark:text-slate-300">
                      {index + 1}
                    </span>
                    <div className="relative h-14 w-[100px] shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-800">
                      <img
                        src={getThumbnailUrl(video.video_id)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      {a.is_completed && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <span className="rounded-full bg-green-500 px-1.5 py-0.5 text-xs font-medium text-white">
                            완료
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-medium text-slate-900 dark:text-white line-clamp-2">
                        {video.title}
                      </h2>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {a.is_weekly_assignment && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            주간 과제
                          </span>
                        )}
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {a.is_completed ? "시청 완료" : `진도 ${(a.progress_percent ?? 0).toFixed(0)}%`}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                        a.is_completed
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {a.is_completed ? "완료" : "미완료"}
                    </span>
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
