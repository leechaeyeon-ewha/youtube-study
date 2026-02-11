"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getThumbnailUrl } from "@/lib/youtube";

interface AssignmentRow {
  id: string;
  is_completed: boolean;
  progress_percent: number;
  videos: { id: string; title: string; video_id: string } | null;
}

export default function StudentPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (profile?.role === "admin") {
        router.replace("/admin");
        return;
      }

      setFullName(profile?.full_name ?? "학생");

      const { data, error: fetchError } = await supabase
        .from("assignments")
        .select("id, is_completed, progress_percent, videos(id, title, video_id, is_visible)")
        .eq("user_id", user.id);

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as (AssignmentRow & { videos?: { is_visible?: boolean } | null })[];
      setAssignments(
        list.filter((a) => (a.videos as { is_visible?: boolean } | null)?.is_visible !== false)
      );
      setLoading(false);
    }

    load();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-zinc-950">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-3">
            <img
              src="/logo.png"
              alt="로고"
              className="h-auto w-[7rem] shrink-0 object-contain sm:w-[7.5rem]"
              aria-hidden
            />
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              영어는 김현정 영어전문학원
            </p>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
            안녕하세요, {fullName} 학생님
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            관리자가 할당한 영상 목록입니다. 클릭하면 시청 페이지로 이동합니다.
          </p>
        </header>

        {assignments.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-slate-500 dark:text-slate-400">
              아직 할당된 영상이 없습니다. 관리자에게 문의하세요.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {assignments.map((a) => {
              const video = a.videos;
              if (!video) return null;
              return (
                <li key={a.id}>
                  <Link
                    href={`/watch/${a.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-800"
                  >
                    <div className="relative h-24 w-[160px] shrink-0 overflow-hidden rounded-xl bg-slate-200 dark:bg-zinc-800">
                      <img
                        src={getThumbnailUrl(video.video_id)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      {a.is_completed && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <span className="rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
                            완료
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {video.title}
                      </h2>
                      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                        {a.is_completed ? "시청 완료" : `진도 ${(a.progress_percent ?? 0).toFixed(0)}%`}
                      </p>
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

        <footer className="mt-12 text-center text-sm text-slate-400">
          © 학원 유튜브 학습 관리 시스템
        </footer>
      </div>
    </div>
  );
}
