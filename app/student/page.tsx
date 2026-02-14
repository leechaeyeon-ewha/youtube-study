"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getThumbnailUrl } from "@/lib/youtube";

type Tab = "student" | "report";

interface AssignmentRow {
  id: string;
  is_completed: boolean;
  progress_percent: number;
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
  videos: { id: string; title: string; video_id: string } | null;
}

interface ReportData {
  allowed: boolean;
  studentName?: string;
  weeklyCompletion?: number;
  monthlyCompletion?: number;
  recentVideos?: { title: string; is_completed: boolean; progress_percent: number; last_watched_at: string | null }[];
  comment?: string;
}

function CircularProgress({ percent, label }: { percent: number; label: string }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const stroke = (percent / 100) * circumference;
  return (
    <div className="flex flex-col items-center">
      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-slate-200 dark:text-zinc-700"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - stroke}
          className="text-indigo-600 dark:text-indigo-400 transition-all duration-500"
        />
      </svg>
      <span className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">{percent}%</span>
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
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

  const [tab, setTab] = useState<Tab>("student");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordChangeMessage, setPasswordChangeMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);

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

  useEffect(() => {
    if (tab !== "report" || !supabase) return;
    setReportLoading(true);
    setReportError(null);
    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.access_token;
      if (!token) {
        setReportError("로그인 세션이 없습니다.");
        setReportLoading(false);
        return;
      }
      fetch("/api/report/me", { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json())
        .then((json: ReportData) => setReportData(json))
        .catch(() => setReportError("리포트를 불러오지 못했습니다."))
        .finally(() => setReportLoading(false));
    });
  }, [tab]);

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
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={async () => {
                if (!supabase) return;
                await supabase.auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
              className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
            >
              로그아웃
            </button>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
            안녕하세요, {fullName} 학생님
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            관리자가 할당한 영상 목록입니다. 클릭하면 시청 페이지로 이동합니다.
          </p>

          {/* 학생 보기 / 리포트(학부모 보기) 탭 — 같은 계정으로 역할에 따라 화면만 다르게 */}
          <div className="mt-6 flex gap-1 rounded-xl bg-slate-200/80 p-1 dark:bg-zinc-800/80">
            <button
              type="button"
              onClick={() => setTab("student")}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                tab === "student"
                  ? "bg-white text-slate-900 shadow dark:bg-zinc-700 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              학생 보기
            </button>
            <button
              type="button"
              onClick={() => setTab("report")}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                tab === "report"
                  ? "bg-white text-slate-900 shadow dark:bg-zinc-700 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              리포트(학부모 보기)
            </button>
          </div>

          {/* 비밀번호 변경 (로그인 후 새 비번으로 변경 가능) */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                setShowPasswordChange((v) => !v);
                setPasswordChangeMessage(null);
                setNewPassword("");
                setNewPasswordConfirm("");
              }}
              className="text-sm text-slate-600 underline hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
            >
              {showPasswordChange ? "비밀번호 변경 닫기" : "비밀번호 변경"}
            </button>
            {showPasswordChange && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                  새 비밀번호를 설정하면 다음 로그인부터 새 비밀번호를 사용합니다.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPasswordChangeMessage(null);
                    if (!newPassword || newPassword.length < 4) {
                      setPasswordChangeMessage({ type: "error", text: "새 비밀번호는 4자 이상 입력해 주세요." });
                      return;
                    }
                    if (newPassword !== newPasswordConfirm) {
                      setPasswordChangeMessage({ type: "error", text: "새 비밀번호가 일치하지 않습니다." });
                      return;
                    }
                    if (!supabase) return;
                    setPasswordChangeLoading(true);
                    try {
                      const { error } = await supabase.auth.updateUser({ password: newPassword });
                      if (error) throw error;
                      setPasswordChangeMessage({ type: "success", text: "비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요." });
                      setNewPassword("");
                      setNewPasswordConfirm("");
                    } catch (err: unknown) {
                      setPasswordChangeMessage({
                        type: "error",
                        text: err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.",
                      });
                    } finally {
                      setPasswordChangeLoading(false);
                    }
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">새 비밀번호</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="4자 이상"
                      minLength={4}
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">새 비밀번호 확인</label>
                    <input
                      type="password"
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      placeholder="다시 입력"
                      minLength={4}
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  {passwordChangeMessage && (
                    <p
                      className={`text-sm ${
                        passwordChangeMessage.type === "error"
                          ? "text-red-600 dark:text-red-400"
                          : "text-green-600 dark:text-green-400"
                      }`}
                    >
                      {passwordChangeMessage.text}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={passwordChangeLoading}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {passwordChangeLoading ? "변경 중…" : "비밀번호 변경"}
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>

        {/* 학생 보기: 과제 목록 + PWA 배너 */}
        {tab === "student" && (
          <>
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
          </>
        )}

        {/* 리포트(학부모 보기): 주간 리포트 UI */}
        {tab === "report" && (
          <>
            {reportLoading && (
              <div className="flex justify-center py-12">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              </div>
            )}
            {!reportLoading && reportError && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-slate-600 dark:text-slate-400">{reportError}</p>
              </div>
            )}
            {!reportLoading && !reportError && reportData && !reportData.allowed && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="font-medium text-slate-800 dark:text-white">접근 권한이 없습니다.</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">학생 계정으로만 리포트를 볼 수 있습니다.</p>
              </div>
            )}
            {!reportLoading && !reportError && reportData?.allowed && (
              <div className="space-y-8">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h2 className="mb-2 text-center text-sm font-medium text-slate-500 dark:text-slate-400">
                    과제 이수율
                  </h2>
                  <p className="mb-6 text-center text-xs text-slate-400 dark:text-slate-500">
                    최근 7일/30일 내 시청한 영상 중 완료(100%)한 비율입니다.
                  </p>
                  <div className="flex justify-center gap-12 sm:gap-16">
                    <CircularProgress percent={reportData.weeklyCompletion ?? 0} label="이번 주 (최근 7일)" />
                    <CircularProgress percent={reportData.monthlyCompletion ?? 0} label="이번 달 (최근 30일)" />
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h2 className="mb-1 text-base font-semibold text-slate-800 dark:text-white">
                    학습 이력 (최근 7일)
                  </h2>
                  <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                    학원 학습관에서 시청한 영상만 진도가 기록됩니다. 각 영상의 저장된 진도 %를 표시합니다.
                  </p>
                  {(reportData.recentVideos ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                      최근 시청한 영상이 없습니다.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {(reportData.recentVideos ?? []).map((v, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-white">
                            {v.title}
                          </span>
                          <span className="shrink-0 text-sm font-medium text-slate-700 dark:text-slate-300">
                            진도 {typeof v.progress_percent === "number" ? v.progress_percent.toFixed(1) : "0"}%
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              v.is_completed
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            }`}
                          >
                            {v.is_completed ? "완료" : "미완료"}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                            {v.last_watched_at
                              ? new Date(v.last_watched_at).toLocaleDateString("ko-KR", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "-"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h2 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">자동 코멘트</h2>
                  <p
                    className={`text-lg font-medium ${
                      (reportData.weeklyCompletion ?? 0) >= 80 || (reportData.monthlyCompletion ?? 0) >= 80
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {reportData.comment ?? "-"}
                  </p>
                </section>

                <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                  영어는 김현정 영어전문학원 · 학부모 전용 리포트 (같은 계정으로 보기)
                </p>
              </div>
            )}
          </>
        )}

        <footer className="mt-12 text-center text-sm text-slate-400">
          © 학원 유튜브 학습 관리 시스템
        </footer>
      </div>
    </div>
  );
}
