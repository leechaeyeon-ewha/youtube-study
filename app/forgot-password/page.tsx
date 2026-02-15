"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [mounted, setMounted] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!fullName.trim()) {
      setMessage({ type: "error", text: "이름을 입력해 주세요." });
      return;
    }
    if (!email.trim()) {
      setMessage({ type: "error", text: "이메일을 입력해 주세요." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "재설정 요청에 실패했습니다.");
      if (data?.success && data?.message) {
        setMessage({ type: "success", text: data.message });
        setFullName("");
        setEmail("");
        return;
      }
      throw new Error(data?.error || "재설정 요청에 실패했습니다.");
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "비밀번호 재설정 요청에 실패했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

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
        <h1 className="mb-2 text-center text-xl font-bold text-slate-900 dark:text-white">
          비밀번호 재설정
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">
          등록된 이름과 이메일을 입력하면, 해당 이메일로 재설정 링크를 보냅니다. 본인 이메일에서만 링크를 열 수 있습니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              이메일
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="등록된 이메일을 입력하세요"
              required
              autoComplete="email"
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
            {loading ? "처리 중…" : "재설정 링크 받기"}
          </button>
        </form>

        <p className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-white"
          >
            ← 로그인으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
