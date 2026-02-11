"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Who = "admin" | "student" | null;
type FormMode = "admin" | "student";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [who, setWho] = useState<Who>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err === "no_profile") {
      setMessage({
        type: "error",
        text: "이 계정에는 프로필이 없습니다. Supabase 대시보드 → profiles 테이블에 이 사용자와 role=admin을 추가해 주세요.",
      });
      window.history.replaceState({}, "", "/login");
    }
  }, [searchParams]);

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setMessage({ type: "error", text: "Supabase 설정이 없습니다." });
      return;
    }
    setMessage(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // 세션이 저장된 뒤 이동하도록 전체 페이지 이동 사용 (그렇지 않으면 /api/auth/me가 세션 못 읽음)
      if (data.session) {
        window.location.href = "/admin";
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "로그인에 실패했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setMessage({ type: "error", text: "Supabase 설정이 없습니다." });
      return;
    }
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/student-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "학생 정보를 찾을 수 없습니다.");

      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password,
      });
      if (error) throw error;
      if (signInData.session) {
        window.location.href = "/student";
        return;
      }
      router.replace("/student");
      router.refresh();
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "이름 또는 비밀번호가 맞지 않습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!supabase) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-8 dark:border-amber-800 dark:bg-amber-900/20">
          <h1 className="mb-4 text-center text-xl font-bold text-zinc-900 dark:text-white">
            설정이 필요합니다
          </h1>
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 설정해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (who === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex justify-center">
            <img
              src="/logo.png"
              alt="영어는 김현정 영어전문학원"
              className="h-auto w-full max-w-[11rem] object-contain"
            />
          </div>
          <h1 className="mb-2 text-center text-2xl font-bold text-zinc-900 dark:text-white">
            학원 학습관
          </h1>
          <p className="mb-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            관리자입니까? 학생입니까?
          </p>
          {message && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {message.text}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setWho("admin")}
              className="rounded-xl bg-indigo-600 py-3.5 font-medium text-white transition hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              관리자
            </button>
            <button
              type="button"
              onClick={() => setWho("student")}
              className="rounded-xl border-2 border-slate-300 py-3.5 font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-200 dark:hover:bg-zinc-800"
            >
              학생
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = who === "admin";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex justify-center">
          <img
            src="/logo.png"
            alt="영어는 김현정 영어전문학원"
            className="h-auto w-full max-w-[11rem] object-contain"
          />
        </div>
        <p className="mb-2 text-center text-sm font-medium text-indigo-600 dark:text-indigo-400">
          영어는 김현정 영어전문학원
        </p>
        <button
          type="button"
          onClick={() => setWho(null)}
          className="mb-4 text-sm text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← 뒤로
        </button>
        <h1 className="mb-6 text-center text-xl font-bold text-zinc-900 dark:text-white">
          {isAdmin ? "관리자 로그인" : "학생 로그인"}
        </h1>

        {isAdmin ? (
          <form onSubmit={handleAdminSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            {message && (
              <div
                className={`rounded-lg px-4 py-3 text-sm ${
                  message.type === "error"
                    ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                    : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                }`}
              >
                {message.text}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleStudentSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                이름
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="등록된 이름을 입력하세요"
                required
                autoComplete="name"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="관리자가 알려준 비밀번호"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            {message && (
              <div
                className={`rounded-lg px-4 py-3 text-sm ${
                  message.type === "error"
                    ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                    : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                }`}
              >
                {message.text}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
