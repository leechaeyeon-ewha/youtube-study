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
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
  videos: { id: string; title: string; video_id: string } | null;
}

/** PWA 설치 가능 여부 및 홈 화면 추가 안내 */
function usePwaInstall() {
  const [showBanner, setShowBanner] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isStandalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) {
      setShowBanner(false);
      return;
    }
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
    const isAndroid = /Android/.test(ua);
    if (isIos) setPlatform("ios");
    else if (isAndroid) setPlatform("android");
    else setPlatform("other");
    setShowBanner(isIos || isAndroid);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt({ prompt: () => (e as unknown as { prompt: () => Promise<void> }).prompt() });
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const runInstall = async () => {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
    } finally {
      setInstalling(false);
    }
  };

  return { showBanner, installPrompt, platform, installing, runInstall };
}

export default function StudentPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showBanner, installPrompt, platform, installing, runInstall } = usePwaInstall();
  const [pwaDismissed, setPwaDismissed] = useState(false);

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
        .select("id, is_completed, progress_percent, is_visible, is_weekly_assignment, videos(id, title, video_id)")
        .eq("user_id", user.id);

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as AssignmentRow[];
      setAssignments(
        list.filter((a) => a.is_visible !== false)
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

        {/* PWA: 앱처럼 사용하기 / 홈 화면에 추가 안내 (학생용) */}
        {showBanner && !pwaDismissed && (
          <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50/80 p-4 dark:border-teal-800 dark:bg-teal-900/20">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-teal-900 dark:text-teal-100">
                  📱 앱처럼 사용하기
                </p>
                <p className="mt-1 text-sm text-teal-700 dark:text-teal-300">
                  홈 화면에 추가하면 앱처럼 쓸 수 있어요. 주소창 없이 편하게 이용할 수 있습니다.
                </p>
                {platform === "ios" && (
                  <p className="mt-2 text-xs text-teal-600 dark:text-teal-400">
                    Safari에서 <strong>공유(□↑)</strong> → <strong>홈 화면에 추가</strong>
                  </p>
                )}
                {platform === "android" && !installPrompt && (
                  <p className="mt-2 text-xs text-teal-600 dark:text-teal-400">
                    Chrome 메뉴(⋮) → <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {platform === "android" && installPrompt && (
                    <button
                      type="button"
                      onClick={runInstall}
                      disabled={installing}
                      className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-600"
                    >
                      {installing ? "설치 중…" : "앱 설치"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPwaDismissed(true)}
                    className="text-sm text-teal-600 underline hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-200"
                  >
                    오늘은 안 할게요
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPwaDismissed(true)}
                className="shrink-0 rounded p-1 text-teal-500 hover:bg-teal-200/50 hover:text-teal-800 dark:hover:bg-teal-700/50 dark:hover:text-teal-200"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
          </div>
        )}

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
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {a.is_weekly_assignment && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            주간 과제
                          </span>
                        )}
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {a.is_completed ? "시청 완료" : `진도 ${(a.progress_percent ?? 0).toFixed(0)}%`}
                        </p>
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

        <footer className="mt-12 text-center text-sm text-slate-400">
          © 학원 유튜브 학습 관리 시스템
        </footer>
      </div>
    </div>
  );
}
