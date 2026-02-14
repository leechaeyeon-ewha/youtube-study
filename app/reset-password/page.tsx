"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setChecked(true);
      setSessionReady(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setChecked(true);
      setSessionReady(!!session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionReady(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword.length < 4) {
      setMessage({ type: "error", text: "비밀번호는 4자 이상 입력해 주세요." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "비밀번호가 일치하지 않습니다." });
      return;
    }
    if (!supabase) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setMessage({ type: "success", text: "비밀번호가 변경되었습니다. 로그인 화면으로 이동합니다." });
      setTimeout(() => {
        router.replace("/login");
        router.refresh();
      }, 1500);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">링크가 만료되었습니다</h1>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
            재설정 링크가 만료되었거나 이미 사용되었습니다. 비밀번호 재설정 페이지에서 다시 시도해 주세요.
          </p>
          <Link
            href="/forgot-password"
            className="inline-block rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            비밀번호 재설정 다시 하기
          </Link>
          <p className="mt-4">
            <Link href="/login" className="text-sm text-slate-500 underline dark:text-slate-400">
              로그인으로 돌아가기
            </Link>
          </p>
        </div>
      </div>
    );
  }

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
        <h1 className="mb-6 text-center text-xl font-bold text-slate-900 dark:text-white">
          새 비밀번호 설정
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              새 비밀번호
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="4자 이상"
              minLength={4}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="다시 입력"
              minLength={4}
              required
              autoComplete="new-password"
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
            {loading ? "변경 중…" : "비밀번호 변경"}
          </button>
        </form>

        <p className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-white"
          >
            로그인으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
